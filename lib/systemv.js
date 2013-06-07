var mu = require('mu2'),
    os = require('os'),
    p = require('path'),
    fs = require('fs'),
    exec = require('child_process').exec,
    supportedos = ['debian','centos','redhat','fedora','ubuntu'];

/**
 * @class nodelinux.systemv
 * A class used to create systemv init scripts to run a Node.js script as a background daemon/service.
 * @param {Object} config
 */
var init = function(config){

  config = config || {};

  Object.defineProperties(this,{

    /**
     * @property {String} templateRoot
     * The root directory where initd templates are stored.
     */
    templateRoot: {
      enumerable: true,
      writable: false,
      configurable: false,
      value: p.join(__dirname,'templates','systemv')
    },

    tpl: {
      enumerable: false,
      writable: true,
      configurable: false,
      value: null
    },

    _label: {
      enumerable: false,
      writable: true,
      configurable: false,
      value: null
    },

    /**
     * @property {String} label
     * The label used for the daemon (file name).
     */
    label: {
      enumerable: true,
      get: function(){
        return this._label;
      }
    },

    exists: {
      enumerable: false,
      get: function(){
        return fs.existsSync('/etc/init.d/'+this.label);
      }
    },

    /**
     * @method generate
     * Generate a systemv init script for the current operating system.
     * @param {Function} callback
     * The callback is fired after the script is generated.
     * @param {Object} callback.script
     * The content of the initd script file.
     */
    generate: {
      enumerable: true,
      writable: false,
      configurable: false,
      value: function(callback){
        callback = callback || function(){};

        var me = this;
        exec('cat /proc/version',function(error, stdout, stderr){
          stdout = stdout.toLowerCase();
          var _os = supportedos.filter(function(i){
            return stdout.indexOf(i) >= 0;
          })[0];

          switch(_os){
            // Use RedHat for CentOS
            case 'centos':
            case 'redhat':
              _os = 'redhat';
              break;

            // Use debian for Ubuntu & default
            case 'ubuntu':
            case 'debian':
            default:
              _os = 'debian';
              break;
          }

          /**
           * @cfg {String} name required
           * The title of the process
           */
          /**
           * @cfg {String} description
           * A description of what the service does.
           */
          /**
           * @cfg {String} [author='Unknown']
           * The author of the process.
           */
          /**
           * @cfg {String} [user='root']
           * The user account under which the process should run.
           */
          /**
           * @cfg {String} [group='root']
           * The user group under which the process should run.
           */
          /**
           * @cfg {String} [pidroot='/var/run']
           * The root directory where the PID file will be created (if applicable to the OS environment).
           */
          /**
           * @cfg {String} [logroot='/var/log']
           * The root directory where the log file will be created.
           */
          /**
           * @cfg {Object} [env]
           * A key/value object containing environment variables that should be passed to the process.
           */
          /**
           * @cfg {String} [template]
           * Use this template with the #generate method to create custom output for the initd script.
           * This should be an absolute filepath.
           */
          opt = {
            label: me.label,
            servicesummary: config.name,
            servicedescription: config.description || config.name,
            author: config.author || 'Unknown',
            script: p.join(__dirname,'wrapper.js'),
            nodescript: config.script || '',
            wrappercode: (config.wrappercode || ''),
            description: config.description,
            user: config.user || 'root',
            group: config.group || 'root',
            pidroot: config.pidroot || '/var/run',
            logroot: config.logroot || '/var/log',
            env: '',
            created: new Date(),
            execpath: process.execPath,
          };

          var _path = config.template == undefined ? p.join(me.templateRoot,_os) : p.resolve(config.template);
          mu.compile(_path,function(err,tpl){
            var stream = mu.render(tpl,opt),
                chunk = "";
            stream.on('data',function(data){
              chunk += data;
            });
            stream.on('end',function(){
              callback(chunk);
            });
          });
        });
      }
    },

    /**
     * @event install
     * Fired when the #install completes.
     */
    /**
     * @event alreadyinstalled
     * Fired when an #install is attempted but the process already exists.
     */

    /**
     * @method createProcess
     * Generate the physical daemon/process file.
     * @param {Function} [callback]
     * An optional callback fired when the process file has been completed.
     * This constitutes an "installation"
     */
    createProcess: {
      enumerable: true,
      writable: false,
      configurable: false,
      value: function(callback){

        var filepath = p.join('/etc/init.d',this.label), me = this;
        fs.exists(filepath,function(exists){
          if(!exists){
            me.generate(function(script){
              fs.writeFile(filepath,script,function(err){
                if (err) throw err;
                fs.chmod(filepath,'755',function(_err){
                  if (_err) throw _err;
                  me.emit('install');
                })
              });
            });
          } else {
            me.emit('alreadyinstalled');
          }
        });
      }
    },

    /**
     * @method removeProcess
     * Remove the process files, including the main init.d script and log files.
     * @param {Function} [callback]
     * An optional callback fired when the files have been removed.
     */
    removeProcess: {
      enumerable: true,
      writable: false,
      configurable: false,
      value: function(callback){

        if (!fs.existsSync('/etc/init.d/'+this.label)){
          this.emit('doesnotexist');
          return;
        }
        var me = this;

        // Remove the main process file first
        fs.unlink('/etc/init.d/'+this.label,function(){
          var lr = require('path').join(me.logroot || '/var/log',this.label+'.log'),
              er = require('path').join(me.logroot || '/var/log',this.label+'-error.log'),
              pr = require('path').join(me.pidroot || '/var/run',this.label+'.pid');

          // Remove the PID
          fs.exists(pr,function(exists){
            exists && fs.unlink(pr);
          });

          // Remove any logs if they exist
          fs.exists(lr,function(exists){
            if (exists){
              fs.unlinkSync(lr);
            }
            fs.exists(er,function(exists){
              if (exists){
                fs.unlinkSync(er);
              }
              me.emit('uninstall');
              callback && callback();
            });
          });
        });
      }
    },

    /**
     * @method start
     * Start the process.
     */
    start: {
      enumerable: true,
      writable: true,
      configurable: false,
      value: function(callback){
        if (!this.exists){
          this.emit('doesnotexist');
          callback && callback();
          return;
        }
        var me = this;
        console.log('service '+this.label+' start');
        exec('service '+this.label+' start',function(err){
          if (err) throw err;
          /**
           * @event start
           * Fired when the #start method completes.
           */
          me.emit('start');
          callback && callback();
        });
      }
    },

    /**
     * @method stop
     * Stop the process.
     */
    stop: {
      enumerable: true,
      writable: true,
      configurable: false,
      value: function(callback){
        if (!this.exists){
          this.emit('doesnotexist');
          callback && callback();
          return;
        }
        var me = this;
        exec('service '+this.label+' stop',function(err){
          if (!err) {
            /**
             * @event stop
             * Fired when the #stop method completes.
             */
            me.emit('stop');
            callback && callback();
          } else {
            me.emit('error',err);
          }
        });
      }
    }

  });

  this._label = (config.name||'').replace(/[^a-zA-Z0-9]/,'').toLowerCase();

};

var util = require('util'),
  EventEmitter = require('events').EventEmitter;

// Inherit Events
util.inherits(init,EventEmitter);

module.exports = init;