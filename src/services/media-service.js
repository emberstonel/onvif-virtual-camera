const logger = require("../log-manager");

class MediaService {
    constructor(camera) {
        this.camera = camera;

        // Protect expects exactly one profile with predictable tokens
        this.profileToken = "profile_1";
        this.videoSourceToken = "video_source_1";
        this.videoSourceConfigToken = "video_source_config_1";
        this.videoEncoderToken = "video_encoder_1";
    }

    buildProfile() {
        return {
            $attributes: {
                token: this.profileToken,
                fixed: true
            },
            Name: "VirtualProfile",
            VideoSourceConfiguration: {
                $attributes: {
                    token: this.videoSourceConfigToken
                },
                Name: "VideoSourceConfig",
                UseCount: 1,
                SourceToken: this.videoSourceToken
            },
            VideoEncoderConfiguration: {
                $attributes: {
                    token: this.videoEncoderToken
                },
                Name: "VideoEncoderConfig",
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
        const streamUri = this.camera.name === "VirtualCam-1A"
            ? `rtsp://${this.camera.ip}:8554/rtsp/defaultPrimary-1?streamType=u`
            : this.camera.rtspUrl;

        logger.debug(
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
            `(ProfileToken=${args && args.ProfileToken}) -> ${this.camera.snapshotUrl}`
        );

        return {
            MediaUri: {
                Uri: this.camera.snapshotUrl,
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
                Name: "VideoSourceConfig",
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
                Name: "VideoEncoderConfig",
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