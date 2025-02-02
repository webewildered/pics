Self-hosted photo and video gallery.

Setup requirements:
* Node.js v20
* ffmpeg, with environment variables FFMPEG_PATH and FFPROBE_PATH set to the full path of ffmpeg.exe and ffprobe.exe respectively
* IIS default upload size limit is too small. In IIS > Sites > Pics > Request Filtering > Edit Feature Settings, increase "Maximum allowed content length".