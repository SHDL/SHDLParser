
var fs = require('fs');
var path = require('path');

var shdlParser = require('./parser');
var Q = require('Q');
var commandLineArgs = require('command-line-args');

var cli = commandLineArgs([
  { name: 'version', alias: 'v', type: Boolean, description: "Print version number" },
  { name: 'verbose', type: Boolean, description: "Provide more details" },
  { name: 'path', type: String, multiple: false, description: "Directory names where SHDL files are looked for; default is '.'" },
  { name: 'src', type: String, multiple: true, defaultOption: true, description: "SHDL file names" },
  { name: 'root', type: String, multiple: false, description: "root module name (default: top of modules hierarchy)" },
  { name: 'help', alias: 'h', type: Boolean, description: "Print usage" }
]);


function readFileInPathWithDeferred(input_file, shdlPath, deferred) {
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
      console.log("version 0.9");
      
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
      if (options.verbose) console.log("--- reading and parsing files...");
      var allPromises = [];
      for (var i = 0; i < options.src.length; i++) {
         var input_file = options.src[i];
         var deferred = Q.defer();
         readFileInPathWithDeferred(input_file, shdlPath, deferred);
         allPromises.push(deferred.promise);
      }
      
      // wait for all file-readings to complete
      Q.all(allPromises)
      // then parse them in the order they were read
      .then(function(fileDescriptions) {
         for (var i = 0; i < fileDescriptions.length; i++) {
            var fileDescription = fileDescriptions[i];
            try {
               // parse file text
               var modules = shdlParser.parse(fileDescription.text);
               // attach associated modules to object
               fileDescription.modules = modules;
            } catch(err) {
               var message = "*** error: " + fileDescription.fullpath + ", line " + err.location.start.line + ', column ' + err.location.start.column + ": " + err.message;
               // error will be reported in .fail statement
               throw new Error(message);
            }
         }
         return fileDescriptions;
      })
      
      // gather information on each module and attach it to module object; look for errors and warnings
      .then(function(fileDescriptions) {
         if (options.verbose) console.log("--- gathering information on modules...");
         for (var i = 0; i < fileDescriptions.length; i++) {
            var fileDescription = fileDescriptions[i];
            for (var j = 0; j < fileDescription.modules.length; j++) {
               var module = fileDescription.modules[j];
               if (options.verbose) console.log(module.name);
               for (var k = 0; k < module.instances.length; k++) {
                  var instance = module.instances[k];
                  if (instance.type === 'assignment') {
                     
                  } else if (instance.type === 'module_instance') {
                     
                  } else if (instance.type === 'fsm') {
                     
                  }
               }
            }
         }
         return fileDescriptions;
      })
      
      .then(function() {
         console.log('Done');
      })
      .fail(function(err) {
         console.log(err.message);
      });

   }
   
} catch(err) {
   // print option error
   console.log(err.message);
   // print usage
   console.log(cli.getUsage());
}

