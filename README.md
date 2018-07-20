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

