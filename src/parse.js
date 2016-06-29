
var fs = require('fs');
var path = require('path');
var Q = require('Q');
var commandLineArgs = require('command-line-args');

var parser = require('./parser');
var checker = require('./checker');
var translator = require('./translator');


var cli = commandLineArgs([
  { name: 'version', alias: 'v', type: Boolean, description: "Print version number" },
  { name: 'verbose', type: Boolean, description: "Provide more details" },
  { name: 'shdlpath', type: String, multiple: false, description: "Directory names, separated by ':', where SHDL files are looked for; default is '.'" },
  { name: 'vhdldir', type: String, multiple: false, description: "Directory where VHDL files will be stored" },
  { name: 'root', type: String, multiple: false, defaultOption: true, description: "name of module to synthesize" },
  { name: 'help', alias: 'h', type: Boolean, description: "Print usage" }
]);


function readFileInPath(input_file, shdlPath, verbose) {
   var deferred = Q.defer();
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
               //if (verbose) console.log(fullpath);
               var fileDescription = { filename: input_file, fullpath: fullpath, text: text };
               deferred.resolve(fileDescription);
            }
         });
      }
      readTheFile(input_file, fullpath);
      
   }
   return deferred.promise;
}

function writeFile(output_file, text) {
   var deferred = Q.defer();
   fs.writeFile('temp_file', text, function(err) {
      if (err) {
         var message = "*** error: cannot write output file " + output_file;
         deferred.reject(message);
      } else {
         deferred.resolve(text);
      }
   });
   return deferred.promise;
}


try {
   var options = cli.parse();   
   
   if (options.version) {
      console.log("version 0.8.0");
      
   } else if (options.help) {
      console.log(cli.getUsage());
      
   } else {
      if (options.verbose) console.log(options);
      
      // split --path parts
      var shdlPath = (options.shdlpath ? options.shdlpath : '.').split(":");
      
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
      
      // recursively look for module definition of <moduleName> and its submodules
      // returns a promise of all descending module description objects, with root module first
      function readModule(moduleName, alreadyReadModules) {
         var deferred = Q.defer();
         var input_file = moduleName + '.shd';
         // wait for file-reading to complete then parse file content and display syntactic errors
         readFileInPath(input_file, shdlPath, options.verbose)
         .then(function(fileDescription) {
            try {
               // parse file text
               var modules = parser.parse(fileDescription.text);
               // look for submodules and add them to modulesToRead when they are not in allReadModules
               for (var j = 0; j < modules.length; j++) {
                  var module = modules[j];
                  // associate to module the path of the file where it is defined
                  module.fullpath = fileDescription.fullpath;
                  // update alreadyReadModules
                  if (alreadyReadModules.map(function(m) { return m.name; }).indexOf(module.name) === -1) {
                     if (options.verbose) console.log("--- module '" + module.name + "' found in '" + fileDescription.fullpath + "'");
                     alreadyReadModules.push(module);
                  }
                  var allPromises = [];
                  for (var i = 0; i < module.instances.length; i++) {
                     var instance = module.instances[i];
                     if (instance.type === 'module_instance') {
                        if (alreadyReadModules.map(function(m) { return m.name; }).indexOf(instance.name) === -1) {
                           // submodule has no definition yet: recursively read it
                           var promise = readModule(instance.name, alreadyReadModules);
                           allPromises.push(promise);
                        }
                     }
                  }
                  Q.all(allPromises)
                  .then(function() {
                     deferred.resolve(alreadyReadModules);
                  })
                  .fail(function(err) {
                     var message = "aaa";
                     deferred.reject(new Error(message));
                  });
               }
            } catch(err) {
               hasError = true;
               var message = "*** error: " + fileDescription.fullpath + ", line " + err.location.start.line + ', column ' + err.location.start.column + ": " + err.message;
               console.log(message);
               throw new Error();
            }
         })
         .fail(function() {
            var message = "*** error: could not find definition of module '" + moduleName + "'";
            console.log(message);
            throw new Error();
         });
         return deferred.promise;
      }
      
      // read root module and all its descendants
      readModule(options.root, [])
      .then(function(modules) {
         console.log('GG ' + modules.map(function(m) { return m.name; }));
         
         // root module is first
         var rootModule = modules[0];
         
         // check modules and translate them into VHDL files
         for (var i = 0; i < modules.length; i++) {
            var module = modules[i];
            
            // check module
            checker.collectEquipotentials(module);
            // translate module into vhdl file in path directory
            translator.convertToVHDL(module, path);
            
         }
         
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

