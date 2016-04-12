/* ==========
    Requires
   ========== */
var chalk      = require('chalk');
var child      = require('child_process');
var app        = require('express')();
var handlebars = require('express-handlebars');


/* ==========
      Main
   ========== */
console.log(chalk.bold.white('Git Branch Onlinifier'));

// Vars
var servers = [];
var hbs = handlebars.create({
    defaultLayout: 'main',
    helpers: {
        getServersOnline: function() {
            return servers;
        },
        getServersOnlineCount: function() {
            return servers.length;
        },
        checkout: function(repoName, branchName) {
            checkoutBranch(repoName, branchName);
        }
    }
})

// Get the arguments
var args = process.argv.slice(2);

if(args.length > 0) {
    switch(args[0]) {
        case '-h':
            printHelp();
            break;

        case 'init':
            printHelp();
            break;

        // Starts just the express server, to handle external calls
        case 'listen':
            listen();
            break;

        default:
            checkoutBranch(args[0], args[1]);
            break;
    }
} else {
    logError('No arguments given. For usage information run: ' + chalk.bold('node gbo -h'));
}



/* ============
      Routes
         &
      Express
   ============ */
app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');

app.get('/', function(req, res) {
    logDebug('GET /');
    res.render('index', { servers: servers });
});

app.get('/spawn', function(req, res) {
    logDebug('Spawning ' + req.query.repo + ' @ ' + req.query.branch);
    res.render('spawn', { repoName: req.query.repo, branchName: req.query.branch });
    checkoutBranch(req.query.repo, req.query.branch);
});

app.get('/killAll', function(req, res) {
    logDebug('Killing all servers');
    res.render('killAll');
    killAllServers();
});


/* =============
     Functions
   ============= */
function printHelp() {
    console.log(chalk.green('Help'));
    logDebug('Not implemented yet 🙈');
}

function listen() {
    app.listen(9999, function() {
        logDebug('Express listening on post 9999');
    });
}

function killAllServers() {
    if(servers && servers.length > 0) {
        for(var i = 0; i < servers.length; i++) {
            servers[i].kill();
        }

        // Empty the array of dead children
        servers = [];
    }
}

function checkoutBranch(repoName, branchName) {
    logDebug('Checking out branch: ' + chalk.bold.green(branchName) + ' of repository: ' + chalk.bold.blue(repoName));
    require('simple-git')(__dirname + '/repos/' + repoName)
        .outputHandler(function (command, stdout, stderr) {
                stdout.pipe(process.stdout);
                stderr.pipe(process.stderr);
             })
        .pull()
        .checkout(branchName)
        .pull(function(err, update) {
            var opts = { cwd: __dirname + '/repos/' + repoName };

            logDebug('Checkout done.');
            logDebug('Executing npm install...');
            child.exec('npm install', opts, function(err, stdout, stderr) {
                if(err) {
                    logError('npm install failed');
                    logError(err);
                    return;
                }

                logDebug('Executing bower install...');
                child.exec('bower install', opts, function(err, stdout, stderr) {
                    if(err) {
                        logError('bower install failed');
                        logError(err);
                        return;
                    }

                    logDebug('Executing gulp serve...');
                    var childProcess = child.exec('gulp serve', opts, function(err, stdout, stderr) {
                        if(err) {
                            logError('gulp serve failed');
                            logError(err);
                            return;
                        }

                        console.log(stdout);
                    });

                    servers.push(childProcess);
                });
            });
        });
}


/* ====================
     Helper functions
   ==================== */
function logError(msg) {
    console.log(chalk.bold.red('Error: ') + msg);
}

function logDebug(msg) {
    console.log(chalk.bgBlue('Debug') + ': ' + msg);
}