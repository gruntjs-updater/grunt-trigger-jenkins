



module.exports = function(grunt) {
    'use strict';

    var path = require('path');
    var request = require('request');
    var chalk = require('chalk');

    grunt.registerMultiTask('trigger_jenkins', 'Trigger jenkins job and log it\'s progress', function() {

        var logState = undefined;
        var logStateChar = ['|','/','-','\\'];
        var buildStartTime, estimatedDuration;
        var progressInterval, progressing = false;
        var done = this.async(), logStart = 0;

        var options = this.options({
            parameters: [],
            sig: ""+Date.now()

        });

        if(!options.job_url.lastIndexOf("/") != options.job_url.length - 1) options.job_url+="/";
        options.parameters["SIGNATURE"] = options.sig;

        grunt.verbose.writeflags(options, 'Options');

        var triggerOptions = {
            url: options.job_url + "buildWithParameters",
            method: "POST",
            form: options.parameters
        };

        var pollOptions = {
            url: options.job_url + "api/json?depth=1",
            form: options.parameters
        };

        if(options.auth) {
            triggerOptions.auth = options.auth;
            pollOptions.auth = options.auth;

        }

        //trigger jenkins job
        request(triggerOptions , function(error, response, body) {
            //Start polling
            grunt.log.writeln(chalk.cyan("Polling jenkins..."));
            pollStatus();
        });


        function progress(msg){
            var percentage=0;
            if(progressing) return;
            progressing = true;
            if(msg){
                if(logState!==undefined) grunt.log.write("\r");
                grunt.log.writeln(msg);
                logState = undefined;
            }
            else{
                if(logState===undefined) logState = 0;
                logState++;
                if(logState>3) logState = 0;
            }

            grunt.log.write("\r");
            grunt.log.write(chalk.magenta((logState ? logStateChar[logState] : "|")));
            percentage = Math.round( (new Date() - buildStartTime)/estimatedDuration*100);
            if(percentage>0) {
                grunt.log.write(chalk[percentage > 100 ? "red" : "cyan"](" " + percentage + "%"));
                if(percentage > 120){
                    grunt.log.write(chalk.bgRed(" Build is taking longer than estimated... it might be stuck, please check status in jenkins."));
                }
            }

            clearTimeout(progressInterval);
            progressInterval = setTimeout(progress,100);
            progressing = false;
        }

        function pollLog(build, callback) {
            var logOptions = {
                url: build.url + "logText/progressiveText?start=" + logStart
            }
            if(options.auth) {
                logOptions.auth = options.auth;
            }
            request(logOptions, function(error, response, body) {
                var newLogStart = response.headers["x-text-size"];
                if (newLogStart == logStart) {
                    //progress();
                }
                else {
                    logStart = newLogStart;
                    progress(body);
                }
                callback && callback();
            });
        }

        function pollStatus() {
            request(pollOptions, function(error, response, body) {
                body = JSON.parse(body);
                var builds = body.builds;
                var build = builds.filter(function(build) {
                    return build.actions.filter(function(action) {
                        return action.parameters && action.parameters.filter(function(param) {
                            return param.name === "SIGNATURE" && param.value === options.sig;
                        }).length > 0;
                    }).length > 0;
                })[0];

                if (!build || (build && build.building)) {
                    if (!build) {
                        if (body.inQueue) {
                            grunt.log.writeln(chalk.cyan("[" + new Date() + "] Build is not running yet, polling..."));
                            setTimeout(pollStatus, 200);
                        } else {
                            grunt.log.error(chalk.red("Failed to queue build"));
                            done(false);
                        }
                    } else {
                        if(!buildStartTime) {
                            grunt.log.writeln(chalk.cyan("Build started !! and can be viewed at:"));
                            grunt.log.writeln(chalk.blue(build.url));
                            buildStartTime = new Date();
                        }
                        if(buildStartTime && build.estimatedDuration > 0){
                            estimatedDuration = build.estimatedDuration;
                            progress();
                        }
                        pollLog(build, function() {
                            setTimeout(pollStatus, 200);
                        });
                    }
                } else if (build && !build.building) {
                    setTimeout(function() {
                        pollLog(build, function() {
                            progressing = true;
                            progressInterval = setTimeout(progress,100);
                            grunt.log.writeln(chalk[build.result==="SUCCESS"?'green':'red']("\rBuild finished, result= " + build.result ));
                            grunt.log.writeln(chalk.cyan("Build can be viewed at:"));
                            grunt.log.writeln(chalk.blue(build.url));
                            done();
                        });
                    }, 500);
                }
            });
        }


        grunt.log.writeln();
    });

};