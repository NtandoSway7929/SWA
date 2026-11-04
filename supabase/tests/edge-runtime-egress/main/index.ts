Deno.serve(async (request: Request) => {
  const worker = await EdgeRuntime.userWorkers.create({
    servicePath: "/services/egress-probe",
    memoryLimitMb: 64,
    workerTimeoutMs: 20_000,
    noModuleCache: true,
    envVars: [],
    forceCreate: true,
    cpuTimeSoftLimitMs: 5_000,
    cpuTimeHardLimitMs: 10_000,
    staticPatterns: [],
    context: {
      useReadSyncFileAPI: true,
    },
  });

  try {
    return await worker.fetch(request);
  } catch (error) {
    return Response.json(
      {
        error: "edge_runtime_worker_failed",
        message: error instanceof Error ? error.message : "Unknown runtime error",
      },
      { status: 500 },
    );
  }
});
