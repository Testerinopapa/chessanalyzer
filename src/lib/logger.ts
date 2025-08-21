import fs from "fs";
import path from "path";
import pino from "pino";

// Ensure logs directory exists
const logsDirectory = path.join(process.cwd(), "logs");
try {
	fs.mkdirSync(logsDirectory, { recursive: true });
} catch {
	// noop
}

const destination = pino.destination(path.join(logsDirectory, "app.log"));

export const logger = pino({
	level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
}, destination);

export default logger;


