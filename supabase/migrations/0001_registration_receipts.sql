CREATE TABLE registration_receipts (
    receipt_id UUID PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    provider_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('registration', 'cancellation')),
    payload_digest CHAR(64) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, provider_event_id)
);

CREATE INDEX registration_receipts_expiry_idx ON registration_receipts (expires_at);

CREATE TABLE registrations (
    tenant_id TEXT NOT NULL,
    provider_registration_id TEXT NOT NULL,
    provider_event_id TEXT NOT NULL,
    workshop_id TEXT NOT NULL,
    external_participant_id TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    schema_version INTEGER NOT NULL,
    cancelled BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (tenant_id, provider_registration_id)
);

CREATE INDEX registrations_workshop_idx
    ON registrations (tenant_id, workshop_id, occurred_at, provider_registration_id);

CREATE TABLE registration_cancellations (
    tenant_id TEXT NOT NULL,
    provider_event_id TEXT NOT NULL,
    provider_registration_id TEXT NOT NULL,
    sequence BIGINT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    schema_version INTEGER NOT NULL,
    payload_digest CHAR(64) NOT NULL,
    PRIMARY KEY (tenant_id, provider_event_id)
);

CREATE TABLE registration_cancellation_state (
    tenant_id TEXT NOT NULL,
    provider_registration_id TEXT NOT NULL,
    sequence BIGINT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    cancelled BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (tenant_id, provider_registration_id)
);

ALTER TABLE registration_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_cancellation_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON registration_receipts, registrations, registration_cancellations,
    registration_cancellation_state FROM anon, authenticated;
GRANT ALL ON registration_receipts, registrations, registration_cancellations,
    registration_cancellation_state TO service_role;

CREATE OR REPLACE FUNCTION commit_registration(p_registration JSONB, p_receipt JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    saved_receipt registration_receipts%ROWTYPE;
    saved_registration registrations%ROWTYPE;
    registration_tenant TEXT := p_registration->>'tenantId';
    registration_id TEXT := p_registration->>'providerRegistrationId';
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
        registration_tenant || ':' || registration_id, 0
    ));

    INSERT INTO registration_receipts (
        receipt_id, tenant_id, provider_event_id, event_type, payload_digest, received_at, expires_at
    ) VALUES (
        (p_receipt->>'receiptId')::UUID,
        p_receipt->>'tenantId',
        p_receipt->>'providerEventId',
        p_receipt->>'eventType',
        p_receipt->>'payloadDigest',
        (p_receipt->>'receivedAt')::TIMESTAMPTZ,
        (p_receipt->>'expiresAt')::TIMESTAMPTZ
    )
    ON CONFLICT (tenant_id, provider_event_id) DO NOTHING
    RETURNING * INTO saved_receipt;

    IF NOT FOUND THEN
        SELECT * INTO saved_receipt
        FROM registration_receipts
        WHERE tenant_id = p_receipt->>'tenantId'
          AND provider_event_id = p_receipt->>'providerEventId';
        IF saved_receipt.payload_digest = p_receipt->>'payloadDigest'
           AND saved_receipt.event_type = 'registration' THEN
            RETURN jsonb_build_object('kind', 'duplicate', 'receipt', to_jsonb(saved_receipt));
        END IF;
        RETURN jsonb_build_object('kind', 'conflict');
    END IF;

    INSERT INTO registrations (
        tenant_id, provider_registration_id, provider_event_id, workshop_id,
        external_participant_id, occurred_at, received_at, schema_version, cancelled
    ) VALUES (
        registration_tenant,
        registration_id,
        p_registration->>'providerEventId',
        p_registration->>'workshopId',
        p_registration->>'externalParticipantId',
        (p_registration->>'occurredAt')::TIMESTAMPTZ,
        (p_registration->>'receivedAt')::TIMESTAMPTZ,
        (p_registration->>'schemaVersion')::INTEGER,
        COALESCE((
            SELECT state.cancelled
            FROM registration_cancellation_state AS state
            WHERE state.tenant_id = registration_tenant
              AND state.provider_registration_id = registration_id
        ), FALSE)
    )
    ON CONFLICT (tenant_id, provider_registration_id) DO NOTHING
    RETURNING * INTO saved_registration;

    IF NOT FOUND THEN
        DELETE FROM registration_receipts WHERE receipt_id = saved_receipt.receipt_id;
        RETURN jsonb_build_object('kind', 'conflict');
    END IF;

    RETURN jsonb_build_object(
        'kind', 'created',
        'receipt', to_jsonb(saved_receipt)
    );
END;
$$;

CREATE OR REPLACE FUNCTION apply_registration_cancellation(p_cancellation JSONB, p_receipt JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    saved_receipt registration_receipts%ROWTYPE;
    current_state registration_cancellation_state%ROWTYPE;
    is_registered BOOLEAN;
    is_stale BOOLEAN;
    result_kind TEXT;
    cancellation_tenant TEXT := p_cancellation->>'tenantId';
    registration_id TEXT := p_cancellation->>'providerRegistrationId';
    event_sequence BIGINT := (p_cancellation->>'sequence')::BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
        cancellation_tenant || ':' || registration_id, 0
    ));

    INSERT INTO registration_receipts (
        receipt_id, tenant_id, provider_event_id, event_type, payload_digest, received_at, expires_at
    ) VALUES (
        (p_receipt->>'receiptId')::UUID,
        p_receipt->>'tenantId',
        p_receipt->>'providerEventId',
        p_receipt->>'eventType',
        p_receipt->>'payloadDigest',
        (p_receipt->>'receivedAt')::TIMESTAMPTZ,
        (p_receipt->>'expiresAt')::TIMESTAMPTZ
    )
    ON CONFLICT (tenant_id, provider_event_id) DO NOTHING
    RETURNING * INTO saved_receipt;

    IF NOT FOUND THEN
        SELECT * INTO saved_receipt
        FROM registration_receipts
        WHERE tenant_id = p_receipt->>'tenantId'
          AND provider_event_id = p_receipt->>'providerEventId';
        IF saved_receipt.payload_digest = p_receipt->>'payloadDigest'
           AND saved_receipt.event_type = 'cancellation' THEN
            RETURN jsonb_build_object('kind', 'duplicate', 'receipt', to_jsonb(saved_receipt));
        END IF;
        RETURN jsonb_build_object('kind', 'conflict');
    END IF;

    INSERT INTO registration_cancellations (
        tenant_id, provider_event_id, provider_registration_id, sequence,
        occurred_at, received_at, schema_version, payload_digest
    ) VALUES (
        cancellation_tenant,
        p_cancellation->>'providerEventId',
        registration_id,
        event_sequence,
        (p_cancellation->>'occurredAt')::TIMESTAMPTZ,
        (p_cancellation->>'receivedAt')::TIMESTAMPTZ,
        (p_cancellation->>'schemaVersion')::INTEGER,
        p_cancellation->>'payloadDigest'
    );

    SELECT * INTO current_state
    FROM registration_cancellation_state
    WHERE tenant_id = cancellation_tenant
      AND provider_registration_id = registration_id;
    is_stale := FOUND AND event_sequence <= current_state.sequence;

    SELECT EXISTS (
        SELECT 1 FROM registrations
        WHERE tenant_id = cancellation_tenant
          AND provider_registration_id = registration_id
    ) INTO is_registered;

    IF NOT is_stale THEN
        INSERT INTO registration_cancellation_state (
            tenant_id, provider_registration_id, sequence, occurred_at, cancelled
        ) VALUES (
            cancellation_tenant,
            registration_id,
            event_sequence,
            (p_cancellation->>'occurredAt')::TIMESTAMPTZ,
            TRUE
        )
        ON CONFLICT (tenant_id, provider_registration_id) DO UPDATE
        SET sequence = EXCLUDED.sequence,
            occurred_at = EXCLUDED.occurred_at,
            cancelled = TRUE;
        UPDATE registrations
        SET cancelled = TRUE
        WHERE tenant_id = cancellation_tenant
          AND provider_registration_id = registration_id;
    END IF;

    result_kind := CASE
        WHEN is_stale THEN 'stale'
        WHEN is_registered THEN 'cancelled'
        ELSE 'pending-create'
    END;
    RETURN jsonb_build_object('kind', result_kind, 'receipt', to_jsonb(saved_receipt));
END;
$$;

REVOKE ALL ON FUNCTION commit_registration(JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_registration_cancellation(JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION commit_registration(JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION apply_registration_cancellation(JSONB, JSONB) TO service_role;
