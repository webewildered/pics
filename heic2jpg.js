const heicConvert = require('heic-jpg-exif');

const src = process.argv[2];
const dst = process.argv[3];
heicConvert(src, dst)
    .catch((err) =>
    {
        process.stderr.write(err);
        process.exit(1);
    });