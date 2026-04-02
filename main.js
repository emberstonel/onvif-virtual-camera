const fs = require("fs");
const path = require("path");
const logger = require("./src/log-manager");
const configLoader = require("./src/config-loader");
const CameraManager = require("./src/camera-manager");
const DiscoveryManager = require("./src/discovery-manager");

async function start() {
    
    // Begin logging and error tracking
    const startupSummaries = [];
    logger.info("Starting ONVIF Virtual Camera Proxy...");

    // Load config.yaml from local path (for debug) or the mounted root path
    const configPath = fs.existsSync(path.resolve("./config.yml")) ? path.resolve("./config.yml") : "/config.yml";

    let config;
    const discoveryManager = new DiscoveryManager();
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
            const manager = new CameraManager(cam, discoveryManager);
            const summary = await manager.start();
            startupSummaries.push(summary);
            logger.info(`${summary.name} is up at ${summary.ip} (${summary.interface}) using MAC: ${summary.mac}`);
        } catch (err) {
            logger.error(`Failed to initialize camera ${cam.name}: ${err.message}`);
            process.exit(1);
        }
    }
    logger.info(`Initialization complete. ${startupSummaries.length} virtual camera(s) running.`);
}

start();