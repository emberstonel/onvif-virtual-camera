const os = require("os");
const logger = require("./log-manager");

function findInterfaceByMac(targetMac) {
    const normalizedTarget = targetMac.toLowerCase();

    const interfaces = os.networkInterfaces();

    for (const [ifaceName, entries] of Object.entries(interfaces)) {
        for (const entry of entries) {
            if (!entry.mac) continue;

            const mac = entry.mac.toLowerCase();

            if (mac === normalizedTarget) {
                return ifaceName;
            }
        }
    }

    throw new Error(`No interface found with MAC ${targetMac}`);
}

function getInterfaceIp(ifaceName) {
    const interfaces = os.networkInterfaces();
    const entries = interfaces[ifaceName];

    if (!entries) {
        throw new Error(`Interface '${ifaceName}' does not exist`);
    }

    // Prefer IPv4, non-internal
    for (const entry of entries) {
        if (entry.family === "IPv4" && !entry.internal) {
            if (!entry.address) {
                throw new Error(`Interface '${ifaceName}' has no IPv4 address`);
            }
            return entry.address;
        }
    }

    throw new Error(`Interface '${ifaceName}' has no usable IPv4 address`);
}

module.exports = {
    findInterfaceByMac,
    getInterfaceIp
};
