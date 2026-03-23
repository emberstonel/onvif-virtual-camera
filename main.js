const path = require("path");
const logger = require("./src/log-manager");
const configLoader = require("./src/config-loader");
const networkManager = require("./src/network-manager");
const OnvifServer = require("./src/onvif-server");

async function start() {
    logger.info("Starting ONVIF Virtual Camera Proxy...");

    // Load config.yaml from the mounted root path
    const configPath = path.join("/", "config.yaml");

    let config;
    try {
        config = configLoader.loadConfig(configPath);
        logger.info(`Loaded configuration for ${config.cameras.length} virtual cameras`);
    } catch (err) {
        logger.error(`Failed to load config: ${err.message}`);
        process.exit(1);
    }

    // Start one ONVIF server per virtual camera
    for (const cam of config.cameras) {
        try {
            logger.info(`Initializing virtual camera: ${cam.name}`);

            // Determine interface name by MAC
            const iface = networkManager.findInterfaceByMac(cam.mac);
            if (!iface) {
                logger.error(`No interface found for MAC ${cam.mac} (camera ${cam.name})`);
                continue;
            }

            // Get assigned IP address
            const ip = networkManager.getInterfaceIPv4(iface);
            if (!ip) {
                logger.error(`Interface ${iface} has no IPv4 address (camera ${cam.name})`);
                continue;
            }

            logger.info(`Camera ${cam.name} bound to ${iface} with IP ${ip}`);

            // Start ONVIF server
            const server = new OnvifServer({
                name: cam.name,
                ip,
                port: cam.port || 80,
                rtspUrl: cam.rtspUrl,
                snapshotUrl: cam.snapshotUrl
            });

            await server.start();
            logger.info(`ONVIF server started for ${cam.name} at http://${ip}:${cam.port || 80}/onvif/device_service`);

        } catch (err) {
            logger.error(`Failed to initialize camera ${cam.name}: ${err.message}`);
        }
    }

    logger.info("Initialization complete. ONVIF servers running.");
}

start();
