const fs = require("fs");
const path = require("path");
const readdir = require("fs-readdir-recursive");
const outputFileSync = require("output-file-sync");
const promisify = require("util.promisify");
const mkdirp = promisify(require("mkdirp"));

const babili = require("./");
const EXTENSIONS = [".js", ".mjs"];

const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const lstat = promisify(fs.lstat);

// set defaults
const readFile = file => readFileAsync(file, { encoding: "utf-8" });
const writeFile = (file, data) =>
  writeFileAsync(file, data, { encoding: "utf-8" });

function isJsFile(file) {
  return EXTENSIONS.some(ext => path.basename(file, ext) !== file);
}

async function isDir(p) {
  try {
    return (await lstat(p)).isDirectory();
  } catch (e) {
    return false;
  }
}

async function isFile(p) {
  try {
    return (await lstat(p)).isFile();
  } catch (e) {
    return false;
  }
}

// the async keyword simply exists to denote we are returning a promise
// even though we don't use await inside it
async function readStdin() {
  let code = "";
  const stdin = process.stdin;
  return new Promise(resolve => {
    stdin.setEncoding("utf8");
    stdin.on("readable", () => {
      const chunk = process.stdin.read();
      if (chunk !== null) code += chunk;
    });
    stdin.on("end", () => {
      resolve(code);
    });
  });
}

async function handleStdin(outputFilename, options) {
  const { code } = babili(await readStdin(), options);
  if (outputFilename) {
    await writeFile(outputFilename, code);
  } else {
    process.stdout.write(code);
  }
}

async function handleFile(filename, outputFilename, options) {
  const { code } = babili(await readFile(filename), options);
  if (outputFilename) {
    await writeFile(outputFilename, code);
  } else {
    process.stdout.write(code);
  }
}

async function handleFiles(files, outputDir, options) {
  if (!outputDir) {
    throw new TypeError(`outputDir is falsy. Got "${outputDir}"`);
  }

  if (!await isDir(outputDir)) {
    throw new TypeError(`outputDir "${outputDir}" is not a directory`);
  }

  return Promise.all(
    files.map(file => {
      const outputFilename = path.join(outputDir, path.basename(file));
      return mkdirp(path.dirname(outputFilename)).then(() =>
        handleFile(file, outputFilename, options)
      );
    })
  );
}

async function handleDir(dir, outputDir, options) {
  if (!outputDir) {
    throw new TypeError(`outputDir is falsy`);
  }

  if (!await isDir(outputDir)) {
    throw new TypeError(`outputDir "${outputDir}" is not a directory`);
  }

  // relative paths
  const files = readdir(dir);

  return Promise.all(
    files.filter(file => isJsFile(file)).map(file => {
      const outputFilename = path.join(outputDir, file);
      return mkdirp(path.dirname(outputFilename)).then(() =>
        handleFile(file, outputFilename, options)
      );
    })
  );
}

async function handleArgs(args, outputDir, options) {
  const files = [];
  const dirs = [];

  for (const arg of args) {
    if (await isFile(arg)) {
      files.push(arg);
    } else if (await isDir(arg)) {
      dirs.push(arg);
    } else {
      throw new TypeError(`Input "${arg}" is neither a file nor a directory.`);
    }
  }

  return Promise.all([
    handleFiles(files, outputDir, options),
    ...dirs.map(dir => handleDir(dir, outputDir, options))
  ]);
}

module.exports = {
  handleFile,
  handleStdin,
  handleFiles,
  handleDir,
  handleArgs
};

module.exports.processFiles = function(fileList, options) {
  const { fileOpts, options: babiliOpts } = detachOptions(options);
  const { stdin, outFile } = fileOpts;
  if (stdin) {
    readStdin().then(input => {
      let { code } = babili(input, babiliOpts);
      // write to stdout if ouput file is not specified
      if (outFile === void 0) {
        process.stdout.write(code + "\n");
      } else {
        fs.writeFileSync(path.resolve(outFile), code, "utf-8");
      }
    });
  } else {
    for (let filename of fileList) {
      handle(filename, fileOpts, babiliOpts);
    }
  }
};

function handle(filename, fileOpts, babiliOpts) {
  if (!fs.existsSync(filename)) return;

  const { outFile } = fileOpts;
  if (outFile !== undefined) {
    transform(filename, outFile, babiliOpts);
    return;
  }

  const stat = fs.statSync(filename);
  if (stat.isDirectory()) {
    const dirname = filename;
    readdir(dirname).forEach(filename => {
      const src = path.join(dirname, filename);
      handleFile(src, filename, fileOpts, babiliOpts);
    });
  } else {
    handleFile(filename, filename, fileOpts, babiliOpts);
  }
}

function handleFile(src, relative, fileOpts, babiliOpts) {
  const ext = getValidFileExt(relative);
  if (ext === undefined) {
    return;
  }
  const { outDir } = fileOpts;
  let dest;
  const filename = getFileName(relative, ext);
  if (outDir) {
    dest = path.join(outDir, path.dirname(relative), filename);
  } else {
    dest = path.join(path.dirname(src), filename);
  }
  transform(src, dest, babiliOpts);
}

function transform(src, dest, babiliOpts) {
  const input = fs.readFileSync(src, "utf-8");
  const { code } = babili(input, babiliOpts);
  outputFileSync(dest, code, "utf-8");
}

function detachOptions(options) {
  const cliOpts = ["stdin", "outFile", "outDir"];
  const fileOpts = {};
  cliOpts.forEach(k => {
    fileOpts[k] = options[k];
    delete options[k];
  });

  return { fileOpts, options };
}

function getValidFileExt(filename) {
  const ext = path.extname(filename);
  const isValidExt = EXTENSIONS.some(e => e.indexOf(ext) >= 0);

  if (isValidExt) {
    return ext;
  }
  return "";
}

function getFileName(filePath, ext) {
  let filename = path.basename(filePath, ext);
  filename = filename.indexOf(".min") >= 0 ? filename : `${filename}.min`;
  return `${filename}${ext}`;
}
