
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
         var readFilePromise = readFileInPath(input_file, shdlPath, options.verbose);
         // wait for file-reading to complete then parse it and display syntactic errors
         readFilePromise
         .then(function(fileDescription) {
            try {
               // parse file text
               var modules = shdlParser.parse(fileDescription.text);
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
         
         // create a dictionary of modules indexed by name
         var modulesDict = {};
         for (var i = 0; i < modules.length; i++) {
            var module = modules[i];
            modulesDict[module.name] = modules[i];
         }
         
         // for each module, create a dictionary of all its equipotentials indexed by name
         for (var i = 0; i < modules.length; i++) {
            var module = modules[i];
            module.equipotentials = {};
            
            // update module.equipotentials with equipotential
            function registerEquipotential(equipotential) {
               if (equipotential.type === 'scalar') {
                  if (module.equipotentials.hasOwnProperty(equipotential.name)) {
                     var equi = module.equipotentials[equipotential.name];
                     if (equi.type === 'vector') {
                        // scalar signal previously defined as a vector signal
                        var message = "*** error: " + module.fullpath + " - signal '" + equipotential.name + "' is used as a scalar, line " +
                           equipotential.location.start.line + ', column ' + equipotential.location.start.column +
                           ", whereas it is used as a vector, line " +
                           equi.location.start.line + ', column ' + equi.location.start.column;
                        console.log(message);
                        throw new Error();
                     }
                  } else {
                     module.equipotentials[equipotential.name] = equipotential;
                  }
               } else if (equipotential.type === 'vector') {
                  if (module.equipotentials.hasOwnProperty(equipotential.name)) {
                     var equi = module.equipotentials[equipotential.name];
                     if (equi.type === 'scalar') {
                        // vector signal previously defined as a scalar signal
                        if (equi.type !== 'vector') {
                           var message = "*** error: " + module.fullpath + " - signal '" + equipotential.name + "' is used as a vector, line " +
                              equipotential.location.start.line + ', column ' + equipotential.location.start.column +
                              ", whereas it is used as a scalar, line " +
                              equi.location.start.line + ', column ' + equi.location.start.column;
                           console.log(message);
                           throw new Error();
                        } else {
                           // extend vector start and/or end indexes
                           equi.start = Math.min(equi.start, equipotential.start);
                           equi.stop = Math.max(equi.stop, equipotential.stop);
                        }
                     }
                  } else {
                     module.equipotentials[equipotential.name] = equipotential;
                  }
               }
            }
            
            // register equipotentials in module interface
            for (var j = 0; j < module.params.length; j++) {
               var param = module.params[j];
               registerEquipotential(param);
            }
            
            function registerSumOfTerms(equation) {
               for (var i = 0; i < equation.terms; i++) {
                  registerTerm(equation.terms[i]);
               }
            }
            
            function registerTerm(term) {
               for (var i = 0; i < term.maxterms; i++) {
                  registerMaxTerm(term.maxterms[i]);
               }
            }
            
            function registerMaxTerm(maxterm) {
               registerEquipotential(maxterm.signal);
            }
            
            // register equipotentials in module assignments, tri-states, submodule instances and fsm's
            for (var i = 0; i < module.instances.length; i++) {
               var instance = module.instances[i];
               
               if (instance.type === 'assignment') {
                  // register left-term signal
                  registerEquipotential(instance.signal);
                  // register equation
                  registerSumOfTerms(instance.equation);
                  
               } else if (instance.type === 'tri_state') {
                  // register left-term signal
                  registerEquipotential(instance.signal);
                  // register equation
                  registerSumOfTerms(instance.equation);
                  // register output enable maxterm
                  registerMaxTerm(instance.oe);
                  
               } else if (instance.type === 'module_instance') {
                  for (var i = 0; i < instance.arguments.length; i++) {
                     registerEquipotential(instance.arguments[i]);
                  }
                  
               } else if (instance.type === 'fsm') {
                  
               }
            }
            
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

