const util = require("util");

function timestamp() {
    return new Date().toISOString();
}

function format(level, msg) {
    return `[${timestamp()}] [${level}] ${msg}`;
}

module.exports = {
    debug(msg, ...args) {
        console.debug(format("DEBUG", util.format(msg, ...args)));
    },

    info(msg, ...args) {
        console.log(format("INFO", util.format(msg, ...args)));
    },

    warn(msg, ...args) {
        console.warn(format("WARN", util.format(msg, ...args)));
    },

    error(msg, ...args) {
        console.error(format("ERROR", util.format(msg, ...args)));
    }
};