
module.exports = (function() {
   "use strict";


   function checkModules(modules) {
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
         
         function registerExpression(expression) {
            for (var i = 0; i < expression.length; i++) {
               var term = expression[i];
               for (var j = 0; j < term.length; j++) {
                  var factor = term[j];
                  if (factor.type === 'expr') {
                     registerExpression(factor.expr);
                  } else if (factor.type === 'bitfield') {
                  } else if (factor.type === 'maxterm') {
                     registerEquipotential(factor.signal);
                  }
               }
            }
         }
         
         
         // register equipotentials in module interface
         for (var j = 0; j < module.params.length; j++) {
            var param = module.params[j];
            registerEquipotential(param);
         }
         
         // register equipotentials in module assignments, tri-states, submodule instances and fsm's
         for (var i = 0; i < module.instances.length; i++) {
            var instance = module.instances[i];
            
            if (instance.type === 'assignment') {
               // register signals present in left part of assignment
               for (var j = 0; j < instance.leftPart.length; j++) {
                  var signal = instance.leftPart[j];
                  registerEquipotential(signal);
               }
               // register signals present in right part of assignment
               for (var j = 0; j < instance.rightPart.length; j++) {
                  var expression = instance.rightPart[j];
                  registerExpression(expression);
               }
               
            } else if (instance.type === 'tri_state') {
               
            } else if (instance.type === 'module_instance') {
               for (var i = 0; i < instance.arguments.length; i++) {
                  registerEquipotential(instance.arguments[i]);
               }
               
            } else if (instance.type === 'fsm') {
               
            }
         }
      }
   }

   return {
      checkModules: checkModules
   };
  
})();

