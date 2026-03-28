const fs = require("fs");
const path = require("path");
const logger = require("./src/log-manager");
const configLoader = require("./src/config-loader");
const networkManager = require("./src/network-manager");
const OnvifServer = require("./src/onvif-server");

async function start() {
    
    // Begin logging and error tracking
    let startupError = false;
    logger.info("Starting ONVIF Virtual Camera Proxy...");

    // Load config.yaml from local path (for debug) or the mounted root path
    const configPath = fs.existsSync(path.resolve("./config.yml")) ? path.resolve("./config.yml") : "/config.yml";

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
            const ip = networkManager.getInterfaceIp(iface);
            if (!ip) {
                logger.error(`Interface ${iface} has no IPv4 address (camera ${cam.name})`);
                continue;
            }

            // Build a unified camera object for this cam
            const camera = {
                ...cam,
                interface: iface,
                ip,
                onvifPort: 80
            };

            // Start ONVIF server
            logger.info(`Attempting to bind camera ${cam.name} to ${iface} with IP ${ip}...`);
            const server = new OnvifServer(camera);
            await server.start();
            logger.info(`ONVIF server started for ${cam.name} at http://${ip}:80/onvif/device_service`);

        } catch (err) {
            startupError = true;
            logger.error(`Failed to initialize camera ${cam.name}: ${err.message}`);
        }
    }
    if(!startupError){
        logger.info("Initialization complete. ONVIF servers running.");
    }
}

start();