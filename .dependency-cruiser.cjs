/** Enforce inward dependencies for the application's hexagonal core. */
module.exports = {
  forbidden: [
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-pure',
      comment: 'Domain code has no dependencies on application, runtime, or external packages.',
      severity: 'error',
      from: { path: '^src/domain/' },
      to: {
        path: '^(src/application/|src/infrastructure/|src/bootstrap/|supabase/functions/|tests/|node:|node_modules/)',
      },
    },
    {
      name: 'application-depends-only-inward',
      comment: 'Use cases and ports may depend on domain and application contracts only.',
      severity: 'error',
      from: { path: '^src/application/' },
      to: {
        path: '^(src/infrastructure/|src/bootstrap/|supabase/functions/|tests/|node:|node_modules/)',
      },
    },
    {
      name: 'infrastructure-stays-outside-core-and-composition',
      severity: 'error',
      from: { path: '^src/infrastructure/' },
      to: { path: '^(src/application/use-cases/|src/bootstrap/|supabase/functions/|tests/)' },
    },
    {
      name: 'inbound-adapters-call-ports',
      comment: 'Driving adapters must call inbound ports, not use cases or driven adapters directly.',
      severity: 'error',
      from: { path: '^src/infrastructure/handlers/' },
      to: {
        path: '^src/(application/(use-cases|ports/outbound)/|infrastructure/adapters/|bootstrap/)|^supabase/functions/',
      },
    },
    {
      name: 'outbound-adapters-implement-ports',
      comment: 'Driven adapters may implement outbound ports but must not call use cases or handlers.',
      severity: 'error',
      from: { path: '^src/infrastructure/adapters/' },
      to: {
        path: '^src/(application/(use-cases|ports/inbound)/|infrastructure/handlers/|bootstrap/)|^supabase/functions/',
      },
    },
    {
      name: 'node-source-does-not-import-deno-composition',
      comment: 'Runtime composition roots stay at the outside of their own runtime.',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^supabase/functions/' },
    },
    {
      name: 'supabase-does-not-import-aws-composition',
      severity: 'error',
      from: { path: '^supabase/functions/' },
      to: { path: '^src/bootstrap/aws/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    // Hexagonal boundaries apply to compile-time type imports as well as runtime imports.
    tsPreCompilationDeps: true,
  },
};
