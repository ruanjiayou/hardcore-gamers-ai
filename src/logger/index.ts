import pino from "pino";
import getConfig from "./config";

const rootLogger = pino(getConfig());

export default rootLogger;