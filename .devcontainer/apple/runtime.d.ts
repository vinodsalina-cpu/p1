export {};

declare global {
  const EdgeRuntime: {
    userWorkers: {
      create(options: {
        servicePath: string;
        memoryLimitMb: number;
        workerTimeoutMs: number;
        noModuleCache: boolean;
        envVars: Array<[string, string]>;
      }): Promise<{
        fetch(request: Request): Promise<Response>;
      }>;
    };
  };
}
