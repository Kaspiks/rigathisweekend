import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);

// WebGL in headless Chrome: the default renderer has no GPU path, 'angle' does. Needed by AutumnStory.
Config.setChromiumOpenGlRenderer('angle');
