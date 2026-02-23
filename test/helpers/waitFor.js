function waitFor(checkFn, timeoutMs = 2000, intervalMs = 20) {
  return new Promise((resolve, reject) => {
    const start = Date.now()

    function evaluate() {
      let passed = false
      try {
        passed = !!checkFn()
      } catch (error) {
        reject(error)
        return
      }

      if (passed) {
        resolve(true)
        return
      }

      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out after ${timeoutMs}ms`))
        return
      }

      setTimeout(evaluate, intervalMs)
    }

    evaluate()
  })
}

module.exports = {
  waitFor
}
