# mastodon-image-bot
A very simple account to allow posting images regularly from a mastodon account


## Description
This bot allows specific senders to DM images to the bot that should be sent by
the bot later. This lets the owner of an image bot fill the bot's queue easily
using their regular Mastodon client.

Each time the bot runs it will attempt to find an image that is suitable for
posting by looking through DMs that have been sent to the bot. If one is found
then the same toot will be resent (with the leading "@botname ") removed. It
will preserve the rest of the toot's body, the CW, etc.

The notification of that DM will then be cleared so that the same image will not
be posted again.

The following options can be modified in the "options" section of the config
file:
	- sendOldest: By default the oldest applicable toot will be sent. If false
	then the most recent applicable toot will be sent instead.

	- cron: If not set then a single toot will be posted (if available) before
	exiting. If set then a toot will be posted repeated on the specified
	schedule (see node-cron for syntax details)

	- visibility: The visibility that should be set for new posts. May be:
		'public' 'unlisted' 'private' or 'direct'. Default is 'public' and
		'direct' is useful for testing.

	- alltoots: By default only images will be reposted. If alltoots is true
	then all DMs sent by an authorized sender will be applicable for reposting.

