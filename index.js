require('dotenv').config()

const { BridgeRuntime, installRuntimeProcessHandlers } = require('./src/bridgeRuntime')

function startBridge() {
  installRuntimeProcessHandlers(process.env)
  const runtime = new BridgeRuntime()
  runtime.startFromEnv()

  const shutdown = (signal) => {
    runtime.log(`[Runtime] received ${signal}`)
    runtime.shutdown(signal)
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  return runtime
}

if (require.main === module) {
  startBridge()
}

module.exports = {
  startBridge
}
