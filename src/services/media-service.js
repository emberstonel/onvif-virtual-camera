const logger = require("../log-manager");

class MediaService {
    constructor(camera) {
        this.camera = camera;
        const tokenSuffix = this.buildTokenSuffix();

        this.profileToken = `profile_${tokenSuffix}`;
        this.videoSourceToken = `video_source_${tokenSuffix}`;
        this.videoSourceConfigToken = `video_source_config_${tokenSuffix}`;
        this.videoEncoderToken = `video_encoder_${tokenSuffix}`;
        this.profileName = `VirtualProfile_${tokenSuffix}`;
        this.videoSourceConfigName = `VideoSourceConfig_${tokenSuffix}`;
        this.videoEncoderConfigName = `VideoEncoderConfig_${tokenSuffix}`;
    }

    buildTokenSuffix() {
        const raw = this.camera?.identity?.serialNumber
            || this.camera?.mac
            || this.camera?.name
            || "camera";

        const normalized = String(raw).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        return normalized || "camera";
    }

    buildProfile() {
        return {
            $attributes: {
                token: this.profileToken,
                fixed: true
            },
            Name: this.profileName,
            VideoSourceConfiguration: {
                $attributes: {
                    token: this.videoSourceConfigToken
                },
                Name: this.videoSourceConfigName,
                UseCount: 1,
                SourceToken: this.videoSourceToken
            },
            VideoEncoderConfiguration: {
                $attributes: {
                    token: this.videoEncoderToken
                },
                Name: this.videoEncoderConfigName,
                UseCount: 1,
                Encoding: this.camera.stream.encoding,
                Resolution: {
                    Width: this.camera.stream.width,
                    Height: this.camera.stream.height
                },
                Quality: this.camera.stream.quality,
                RateControl: {
                    FrameRateLimit: this.camera.stream.framerate,
                    EncodingInterval: 1,
                    BitrateLimit: this.camera.stream.bitrate
                }
            }
        };
    }

    // ONVIF: GetProfiles
    async GetProfiles() {
        return {
            Profiles: [
                this.buildProfile()
            ]
        };
    }

    // ONVIF: GetStreamUri
    async GetStreamUri(args) {
        const streamUri = this.camera.endpoints.rtspUri;

        logger.debug("media",
            `GetStreamUri called for ${this.camera.name} ` +
            `(ProfileToken=${args && args.ProfileToken}) -> ${streamUri}`
        );

        return {
            MediaUri: {
                Uri: streamUri,
                InvalidAfterConnect: false,
                InvalidAfterReboot: false,
                Timeout: "PT0S"
            }
        };
    }

    // ONVIF: GetSnapshotUri
    async GetSnapshotUri(args) {
        logger.debug('media',
            `GetSnapshotUri called for ${this.camera.name} ` +
            `(ProfileToken=${args && args.ProfileToken}) -> ${this.camera.endpoints.snapshotUri}`
        );

        return {
            MediaUri: {
                Uri: this.camera.endpoints.snapshotUri,
                InvalidAfterConnect: false,
                InvalidAfterReboot: false,
                Timeout: "PT0S"
            }
        };
    }

    // ONVIF: GetVideoSources
    async GetVideoSources() {
        return {
            VideoSources: [
                {
                    $attributes: {
                        token: this.videoSourceToken
                    },
                    Framerate: this.camera.stream.framerate,
                    Resolution: {
                        Width: this.camera.stream.width,
                        Height: this.camera.stream.height
                    },
                    Bounds: {
                        $attributes: {
                            x: 0,
                            y: 0,
                            width: this.camera.stream.width,
                            height: this.camera.stream.height
                        }
                    }
                }
            ]
        };
    }

    // ONVIF: GetVideoSourceConfiguration
    async GetVideoSourceConfiguration(args) {
        logger.debug('media',
            `GetVideoSourceConfiguration called for ${this.camera.name} ` +
            `(ConfigurationToken=${args && args.ConfigurationToken})`
        );

        return {
            VideoSourceConfiguration: {
                $attributes: {
                    token: this.videoSourceConfigToken
                },
                Name: this.videoSourceConfigName,
                UseCount: 1,
                SourceToken: this.videoSourceToken
            }
        };
    }

    // ONVIF: GetVideoEncoderConfiguration
    async GetVideoEncoderConfiguration(args) {
        logger.debug('media',
            `GetVideoEncoderConfiguration called for ${this.camera.name} ` +
            `(ConfigurationToken=${args && args.ConfigurationToken})`
        );

        return {
            VideoEncoderConfiguration: {
                $attributes: {
                    token: this.videoEncoderToken
                },
                Name: this.videoEncoderConfigName,
                UseCount: 1,
                Encoding: this.camera.stream.encoding,
                Resolution: {
                    Width: this.camera.stream.width,
                    Height: this.camera.stream.height
                },
                Quality: this.camera.stream.quality,
                RateControl: {
                    FrameRateLimit: this.camera.stream.framerate,
                    EncodingInterval: 1,
                    BitrateLimit: this.camera.stream.bitrate
                }
            }
        };
    }

    GetServiceDefinition() {
        return {
            GetProfiles: this.GetProfiles.bind(this),
            GetStreamUri: this.GetStreamUri.bind(this),
            GetSnapshotUri: this.GetSnapshotUri.bind(this),
            GetVideoSources: this.GetVideoSources.bind(this),
            GetVideoSourceConfiguration: this.GetVideoSourceConfiguration.bind(this),
            GetVideoEncoderConfiguration: this.GetVideoEncoderConfiguration.bind(this)
        };
    }
}

module.exports = MediaService;