import Mastodon		= require('mastodon-api');
import readline		= require('readline');
import https		= require('https');
import fs			= require('fs');
import util			= require('util');
import striptags	= require('striptags');
import program		= require('commander');
import ontime		= require('ontime');
const Entities		= require('html-entities').AllHtmlEntities;
const entities		= new Entities();
const pkg			= require(__dirname + '/package.json');

const writeFile		= util.promisify(fs.writeFile);

function addToList(value, list)
{
	list.push(value);
	return(list);
}

program
.version(pkg.version)
.option('-c, --config <path>',		'Specify the config file that should be used', __dirname + '/config.json')

.option('--authorize',				'Authorize for use with an account, and exit')
.option('-t, --trust <user>',		'Specify a username that should be trusted, and exit', addToList, [])
.option('-d, --distrust <user>',	'Specify a username that should no longer be trusted, and exit', addToList, [])
.option('-D, --dryrun',				'Print info about what would be done, but do not do anything')
.option('-n, --now',				'Ignore configured times and run now')

program.parse(process.argv);
let opts = program.opts();


let rl;
let M;
let account;
let config;
let configChanged	= false;

try {
	config = JSON.parse(fs.readFileSync(opts['config'], 'utf8'));

	config.url.base		= `https://${config.url.host}`;
	config.url.endpoint	= `${config.url.base}/api/v1/`;
} catch (e) {
	if (e.code !== 'ENOENT') {
		console.error(e);
		process.exit(1);
	}

	config = {};
}

set(config,			'senders',		[]);
set(config,			'options',		{});
set(config.options,	'random',		false);
set(config.options,	'sendOldest',	true);
set(config.options,	'visibility',	'public');
set(config.options,	'times',		[]);
set(config.options,	'tags',			[]);
set(config.options,	'boost',		true);
set(config.options,	'alltoots',		false);

if (isNaN(config.options.notifymin)) {
	config.options.notifymin = -1;
	configChanged = true;
}

/* Ensure that all tags do NOT have a leading # */
for (let i = 0, tag; tag = config.options.tags[i]; i++) {
	if ('#' === tag.charAt(0)) {
		config.options.tags[i] = tag.slice(1);
		configChanged = true;
	}
}

/* A sender should NOT have a leading @ */
for (let i = 0, sender; sender = config.senders[i]; i++) {
	if ('@' === sender.charAt(0)) {
		config.senders[i] = sender.slice(1);
		configChanged = true;
	}
}

function set(obj, name, defvalue)
{
	if (!obj || !name) {
		return;
	}

	if ('undefined' === typeof obj[name]) {
		obj[name] = defvalue;
		configChanged = true;
	}
}

function ask(question: string): Promise<string>
{
	if (!rl) {
		rl = readline.createInterface({
			input:	process.stdin,
			output:	process.stdout
		});
	}

	return new Promise((resolve, reject) => {
		rl.question(question, (answer) => {
			resolve(answer);
			// rl.close();
		});
	});
}

// TODO Add an option to add an authorized sender or remove one
function Authorize()
{
	ask('Instance host: ')
	.then((host) => {
		config.url			= {};
		config.url.host		= host;
		config.url.base		= `https://${config.url.host}`;
		config.url.endpoint	= `${config.url.base}/api/v1/`;

		// console.log('Using url: ', config.url.endpoint);
		return Mastodon.createOAuthApp(config.url.endpoint + 'apps', 'mastodon-image-bot');
	})
	.then((res) => {
		// console.log(res);

		config.client = {
			id:		res.client_id,
			secret:	res.client_secret
		};
		return(Mastodon.getAuthorizationUrl(config.client.id, config.client.secret, config.url.base));
	})
	.then((url) => {
		console.log('This is the authorization URL. Open it in your browser and authorize with your account!');
		console.log(url);

		return ask('Please enter the code: ');
	})
	.then((code) => {
		return Mastodon.getAccessToken(config.client.id, config.client.secret, code, config.url.base);
	})
	.then((accessToken) => {
		console.log(`Success!\n${accessToken}`);

		config.accessToken = accessToken;

		// console.log(JSON.stringify(config, null, 4));
		return writeFile(opts['config'], JSON.stringify(config, null, 4), 'utf8');
	})
	.then(() => {
		console.log('Config successfully stored; run again to start');
	})
	.finally(() => {
		rl.close();
		rl = null;
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	})
}

function Dismiss(id: number | string): Promise<void>
{
	if (opts['dryrun']) {
		console.log('NOT Dismissing: ' + id);
		return Promise.resolve();
	}

	console.log('Dismissing: ' + id);
	return M.post('notifications/dismiss', { id: id })
	.then((res) => {
		return;
	});
}

function Boost(id: number | string): Promise<void>
{
	if (opts['dryrun']) {
		console.log('NOT boosting: ' + id);
		return Promise.resolve();
	}

	console.log('Boosting: ' + id);
	return M.post('statuses/' + id + '/reblog', { })
	.then((res) => {
		return;
	});
}

function Unboost(id: number): Promise<void>
{
	if (opts['dryrun']) {
		console.log('NOT unboosting: ' + id);
		return Promise.resolve();
	}

	console.log('Unboosting: ' + id);
	return M.post('statuses/' + id + '/unreblog', { })
	.then((res) => {
		return;
	});
}

function DownloadImage(id: number, url: string): Promise<string>
{
	return new Promise((resolve, reject) => {
		let name = `/tmp/mastodon-image-bot-${id}`;
		let file = fs.createWriteStream(name);

		let req = https.get(url, function(res) {
			res.pipe(file);
			res.on('end', function() {
				file.close();
				resolve(name);
			});
		});
	});
}

function AttachImage(id: number, url: string, description ?: string): Promise<number>
{
	let imgpath;

	return DownloadImage(id, url)
	.then((path) => {
		imgpath = path;

		let options = { file: fs.createReadStream(imgpath) };

		if (description) {
			(options as any).description = description;
		}

		return M.post('media', options);
	})
	.then((res) => {
		fs.unlinkSync(imgpath);
		return(parseInt(res.data.id));
	});
}

/*
	Cleanup the status text which comes in as HTML and likely starts with a
	mention of the bot's username.

	'<p><span class="h-card"><a href="https://birb.site/@birb" class="u-url mention">@<span>birb</span></a></span> Test <a href="https://birb.site/tags/birb" class="mention hashtag" rel="tag">#<span>birb</span></a> <a href="https://birb.site/tags/bird" class="mention hashtag" rel="tag">#<span>bird</span></a> Moo</p><p>COW</p>'
	'<p><span class="h-card"><a href="https://birb.site/@birb" class="u-url mention">@<span>birb</span></a></span> </p><p>1<br />  2<br />    3<br />      4</p><p>5</p><p>6</p><p>7</p><p>8</p><p>10</p>',
*/
function CleanText(html: string, tags): string
{
	// console.log('CleanText', html);

	/*
		We want to keep any new lines

		Mastodon only gives us a sanitized html document, so attempt to
		replicate the new lines caused by various <br /> tags and <p> tags.
	*/
	html = html.replace(/<br[^>]*>/gi, '\n');
	html = html.replace(/<p[^>]*>/gi, '\n');
	html = html.replace(/<\/p>/gi, '\n');

	let text = entities.decode(striptags(html));

	/* Strip any leading mentions */
	let re = /^\s*@[^\s]*\s*/

	while (text.match(re)) {
		text = text.replace(re, '');
	}

	/* Add tags to the end that aren't already present */
	let addTags = [];

	for (let tag of config.options.tags) {
		let found = false;

		for (let t of tags) {
			if (t.name.toLowerCase() === tag.toLowerCase()) {
				found = true;
				break;
			}
		}

		if (!found) {
			addTags.push('#' + tag);
		}
	}

	if (addTags && addTags[0]) {
		text += '\n\n' + addTags.join(' ');
	}

	return(text);
}

function Post(html: string, tags, media, sensitive, cw): Promise<any>
{
	let options = {
		status:			CleanText(html, tags),
		media_ids:		media,
		sensitive:		sensitive,
		visibility:		config.options.visibility || "public"
	};

	if (cw) {
		options['spoiler_text'] = cw;
	}

	return M.post('statuses', options)
	.then((res) => {
		console.log('new status results: ', res.data);
	});
}

function SendAlert(total: number): Promise<any>
{
	let status = [];

	for (let sender of config.senders) {
		status.push('@' + sender);
	}

	if (total) {
		status.push('The queue for this bot only has ' + total + ' items left');
	} else {
		status.push('The queue for this bot is empty');
	}

	let options = {
		status:			status.join(' '),
		visibility:		'direct'
	};

	return M.post('statuses', options)
	.then((res) => {
		console.log('new status results: ', res.data);
	});
}

function isUsableNotification(post, dismissList ?: any[])
{
	if (-1 === post.account.acct.indexOf('@')) {
		/* Sent from local instance */
		post.account.acct += '@' + config.url.host;
	}

	if (!post.status.favourited &&
		(!post.account || -1 == config.senders.indexOf(post.account.acct))
	) {
		/*
			This sender isn't authorized

			Do not dismiss because the owner of the bot may go in and fav the
			toot, making it authorized.
		*/
		return(false);
	}

	if (post.status.visibility !== 'direct') {
		/* Only resend direct messages */
		if (dismissList) {
			dismissList.push(Dismiss(post.id).catch(err => console.log(err)));
		}
		return(false);
	}

	if (!post.status.media_attachments || !post.status.media_attachments[0]) {
		/* We currently only want posts with media */
		if (!config.options.alltoots) {
			if (dismissList) {
				dismissList.push(Dismiss(post.id).catch(err => console.log(err)));
			}
			return(false);
		}
	}

	// console.log('Possible image post: ', post);
	return(true);
}

function BoostTheBest(force: boolean): Promise<any>
{
	console.log('No suitable images to toot; looking for an old one to boost');

	let best = null;
	let options = {
		only_media:		true,
		limit:			30,
		exclude_types:	[ 'follow', 'favourite', 'reblog' ]
	};

	return M.get('accounts/verify_credentials', {})
	.then((res) => {
		// console.log('Account:', res.data);

		return M.get('accounts/' + res.data.id + '/statuses', options)
	})
	.then((res) => {
		let p = [];

		for (let post of res.data) {
			if (post.reblogged) {
				continue;
			}

			if (!best) {
				best = post;
			} else if (	(post.reblogs_count + post.favourites_count) >
						(best.reblogs_count + best.favourites_count)
			) {
				best = post;
			}
		}

		if (best) {
			/* Boost the best */
			p.push(Boost(best.id));
		} else {
			if (force) {
				/* Unboost all boosted toots */
				for (let post of res.data) {
					if (post.reblogged) {
						p.push(Unboost(post.id));
					}
				}

				/* Run again, but without the unboost pass */
				return(BoostTheBest(false));
			}
		}

		return Promise.all(p);
	});
}

function FindImage(minimum: number): Promise<any>
{
	let options = {
		only_media:		true,
		limit:			30,
		exclude_types:	[ 'follow', 'favourite', 'reblog' ]
	};

	let image;
	let skip		= 0;
	let total		= 0;

	return M.get('notifications', options)
	.then((res) => {
		let p = [];

		for (let post of res.data) {
			if (isUsableNotification(post, p)) {
				total++;
			}
		}

		if (opts['dryrun']) {
			console.log(`Found ${total} suitable posts, minimum is ${minimum}`);
		}

		if (total <= config.options.notifymin) {
			p.push(SendAlert(total));
		}

		if (total === 0) {
			if (minimum === 0 && config.options.boost) {
				return BoostTheBest(true);
			}

			console.error('No suitable images found');
			return;
		}

		if (total < minimum) {
			console.error(`Skipping this pass because ${total} is less than the minimum required of ${minimum}`);
			return;
		}

		if (config.options.random) {
			/* Random */
			skip = Math.floor(Math.random() * total);
		} else if (config.options.sendOldest) {
			/* Last */
			skip = total - 1;
		} else {
			/* First */
			skip = 0;
		}

		for (let post of res.data) {
			if (!isUsableNotification(post)) {
				continue;
			}

			if (skip-- > 0) {
				continue;
			}

			image = post;
			break;
		}

		/* Wait for all dismiss requests to finish */
		return(Promise.all(p));
	})
	.then(() => {
		if (!image) {
			return;
		}

		if (opts['dryrun']) {
			console.log('NOT reposting: ', image.status);

			for (let attachment of image.status.media_attachments) {
				console.log(attachment);
			}

			console.log('Cleaned: ', CleanText(image.status.content, image.status.tags));
			return;
		}

		/* Re-upload the images */
		let media = [];

		for (let attachment of image.status.media_attachments) {
			// console.log(attachment);
			media.push(AttachImage(attachment.id, attachment.url, attachment.description));
		}

		return Promise.all(media);
	})
	.then((media_ids) => {
		if (!media_ids) {
			return;
		}

		return Dismiss(image.id)
		.then(() => {
			return Post(image.status.content, image.status.tags, media_ids, image.status.sensitive, image.status.spoiler_text)
		});
	});
}

if (!config || !config.url || !config.accessToken || opts['authorize']) {
	console.log('First use; configuring');
	Authorize();
} else {
	M = new Mastodon({
		access_token:	config.accessToken,
		api_url:		config.url.endpoint
	});

	if (opts['trust'].length > 0 || opts['distrust'].length > 0) {
		if (opts['trust']) {
			for (let addr of opts['trust']) {
				/* We don't want a leading @ */
				addr = addr.replace(/^@/, '');

				if (-1 === config.senders.indexOf(addr)) {
					config.senders.push(addr);
				}
			}
		}

		if (opts['distrust']) {
			for (let addr of opts['distrust']) {
				let i;

				/* We don't want a leading @ */
				addr = addr.replace(/^@/, '');

				if (-1 !== (i = config.senders.indexOf(addr))) {
					config.senders.splice(i, 1);
				}
			}
		}

		writeFile(opts['config'], JSON.stringify(config, null, 4), 'utf8')
		.then(() => {
			process.exit(0);
		});
	} else {
		if (!config.senders) {
			console.log('WARNING: There are no allowed senders');
			process.exit(1);
		}

		M.get('accounts/verify_credentials', {})
		.then((res) => {
			// console.log('Account:', res.data);
			account = res.data;
		})
		.then(() => {
			if (configChanged) {
				configChanged = false;
				return writeFile(opts['config'], JSON.stringify(config, null, 4), 'utf8')
				.catch((err) => {
					/* Ignore write errors, leave the config file as is */
					;
				});
			} else {
				return;
			}
		})
		.then(() => {
			/* Normal mode; look for an image to post */
			if (config.options.times && config.options.times[0] && !opts['now']) {
				for (let time of config.options.times) {
					let parts	= time.split('>');
					let cycle	= parts[0].trim();
					let min		= (parts[1] || '0').trim();
					let m		= 0;

					if (0 === min.indexOf('=')) {
						/* >= x */
						m = parseInt(min.slice(1)) - 1;
					} else {
						/* > x */
						m = parseInt(min);
					}

					ontime({
						cycle:	cycle,
						utc:	false,
						single:	false,
						log:	true,
						id:		'@' + account.username + '@' + config.url.host + ' ' + cycle
					}, (ot) => {
						FindImage(m)
						.then(() => {
							ot.done();
						});
					});
				}
			} else {
				return FindImage(0);
			}
		})
	}
}

