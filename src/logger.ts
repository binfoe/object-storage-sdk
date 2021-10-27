class Logger {
  logTrace: boolean;
  constructor(logTrace = process.env.NODE_ENV !== 'production') {
    this.logTrace = logTrace;
  }

  debug(message: unknown) {
    console.debug(message);
  }

  log(...args: unknown[]) {
    this.log(...args);
  }

  info(...args: unknown[]) {
    this.info(...args);
  }

  error(err: unknown) {
    this.error(err);
  }
}

const logger = new Logger();
export default logger;
