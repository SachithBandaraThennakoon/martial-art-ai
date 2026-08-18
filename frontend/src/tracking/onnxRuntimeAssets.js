const ORT_VERSION = "1.27.0";
const ORT_DIST = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist`;

export function configureWasmRuntime(runtime) {
  runtime.env.wasm.numThreads = 1;
  runtime.env.wasm.proxy = false;
  runtime.env.wasm.wasmPaths = {
    mjs: `${ORT_DIST}/ort-wasm-simd-threaded.mjs`,
    wasm: "/ort-wasm/ort-wasm-simd-threaded.wasm",
  };
  return runtime;
}

export function configureWebGpuRuntime(runtime) {
  runtime.env.wasm.numThreads = 1;
  runtime.env.wasm.proxy = false;
  runtime.env.wasm.wasmPaths = {
    mjs: `${ORT_DIST}/ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: "/ort-wasm/ort-wasm-simd-threaded.asyncify.wasm",
  };
  return runtime;
}
