
var fs = require('fs');
var path = require('path');

var shdlParser = require('./parser');
var Q = require('Q');
var commandLineArgs = require('command-line-args');

var cli = commandLineArgs([
  { name: 'version', alias: 'v', type: Boolean, description: "Print version number" },
  { name: 'verbose', type: Boolean, description: "Provide more details" },
  { name: 'shdlpath', type: String, multiple: false, description: "Directory names, separated by ':', where SHDL files are looked for; default is '.'" },
  { name: 'vhdldir', type: String, multiple: false, description: "Directory where VHDL files will be stored" },
  { name: 'src', type: String, multiple: true, defaultOption: true, description: "SHDL file names" },
  { name: 'root', type: String, multiple: false, description: "root module name (default: top of modules hierarchy)" },
  { name: 'help', alias: 'h', type: Boolean, description: "Print usage" }
]);


function readFileInPathWithDeferred(input_file, shdlPath, deferred, verbose) {
   var notFoundCount = 0;
   for (var i = 0; i < shdlPath.length; i++) {
      var fullpath = path.join(shdlPath[i], input_file);
      
      // create a closure to remember input_file & fullpath at resolution/rejection time
      function readTheFile(input_file, fullpath) {
         fs.readFile(fullpath, 'utf8', function(err, text) {
            if (err) {
               notFoundCount += 1;
               if (notFoundCount === shdlPath.length) {
                  // file not found in any of shdlPath's parts: report a rejection
                  var message = '*** error: file not found ' + input_file;
                  deferred.reject(new Error(message));
               }
            } else {
               // file found: create and report a file description
               if (verbose) console.log(fullpath);
               var fileDescription = { filename: input_file, fullpath: fullpath, text: text };
               deferred.resolve(fileDescription);
            }
         });
      }
      readTheFile(input_file, fullpath);
      
   }
}

function writeFileWithDeferred(output_file, text, deferred) {
   fs.writeFile('temp_file', text, function(err) {
      if (err) {
         var message = "*** error: cannot write output file " + output_file;
         deferred.reject(message);
      } else {
         deferred.resolve(text);
      }
   });
}

try {
   var options = cli.parse();   
   //console.log(options);
   
   if (options.version) {
      console.log("version 0.8.0");
      
   } else if (options.help) {
      console.log(cli.getUsage());
      
   } else {
      // split --path parts
      var shdlPath = (options.path ? options.path : '.').split(":");
      
      // check that all path directories exist
      for (var i = 0; i < shdlPath.length; i++) {
         function checkDir(dir) {
            fs.lstat(dir, function(err, stats) {
               if (err || !stats.isDirectory()) {
                  var message = "*** warning: --path option, directory " + dir + " does not exist";
                  console.log(message);
               }
            });
         }
         checkDir(shdlPath[i]);
      }
      
      // read files in sequence
      if (options.verbose) console.log("--- looking up and reading files...");
      var allPromises = [];
      for (var i = 0; i < options.src.length; i++) {
         var input_file = options.src[i];
         var deferred = Q.defer();
         readFileInPathWithDeferred(input_file, shdlPath, deferred, options.verbose);
         allPromises.push(deferred.promise);
      }
      
      // wait for all file-readings to complete
      Q.all(allPromises)
      // then parse them in the order they were read and display syntactic errors
      .then(function(fileDescriptions) {
         if (options.verbose) console.log("--- checking syntax...");
         var hasError = false;
         for (var i = 0; i < fileDescriptions.length; i++) {
            var fileDescription = fileDescriptions[i];
            try {
               // parse file text
               var modules = shdlParser.parse(fileDescription.text);
               // attach associated modules to object
               fileDescription.modules = modules;
            } catch(err) {
               hasError = true;
               var message = "*** error: " + fileDescription.fullpath + ", line " + err.location.start.line + ', column ' + err.location.start.column + ": " + err.message;
               console.log(message);
            }
         }
         if (hasError) {
            // error will be reported in .fail statement
            throw new Error();
         }
         return fileDescriptions;
      })
      
      // build a dictionary of modules descriptions
      .then(function(fileDescriptions) {
         var moduleDescriptionDict = {};
         for (var i = 0; i < fileDescriptions.length; i++) {
            var fileDescription = fileDescriptions[i];
            for (var j = 0; j < fileDescription.modules.length; j++) {
               var module = fileDescription.modules[j];
               if (options.verbose) console.log(module.name);
               // check if module has been defined already
               if (moduleDescriptionDict.hasOwnProperty(module.name)) {
                  var prevModuleDescription = moduleDescriptionDict[module.name];
                  var message = "*** warning: module " + module.name + " in file " + fileDescription.fullpath + " has already been defined in file " + prevModuleDescription.fullpath + " -- ignoring ";
                  console.log(message);
               } else {
                  moduleDescriptionDict[module.name] = {
                     module: module,
                     fullpath: fileDescription.fullpath,
                     subModules: [],
                  };
               }
            }
         }
         return moduleDescriptionDict;
      })
      
      // gather information on each module and attach it to moduleDescription; look for errors and warnings
      .then(function(moduleDescriptionDict) {
         if (options.verbose) console.log("--- checking coherence...");
         // in javascript dictionaries, keys are ordered
         for (var moduleName in moduleDescriptionDict) {
            if (moduleDescriptionDict.hasOwnProperty(moduleName)) {
               var moduleDescription = moduleDescriptionDict[moduleName];
               var module = moduleDescription.module;
               
               for (var i = 0; i < module.instances.length; i++) {
                  var instance = module.instances[i];
                  if (instance.type === 'assignment') {
                     
                  } else if (instance.type === 'tri_state') {
                     
                  } else if (instance.type === 'module_instance') {
                     // update list of submodules of module
                     if (moduleDescription.subModules.indexOf(instance.name) == -1) {
                        moduleDescription.subModules.push(instance.name);
                     }
                     
                  } else if (instance.type === 'fsm') {
                     
                  }
               }
            }
         }
         return moduleDescriptionDict;
      })
      
      // the end
      .then(function() {
         if (options.verbose) console.log('Done');
      })
      .fail(function(err) {
         // display error messages coming from '.reject(message)' or 'throw new Error(message)'
         if (err.message) console.log(err.message);
      });

   }
   
} catch(err) {
   // print option error
   console.log(err.message);
   // print usage
   console.log(cli.getUsage());
}

