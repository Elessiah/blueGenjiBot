# BDD

## General

This file contains the class which manage the database and the getter to get the instance wherever you are in the 
project.

## Constructor

The constructor is very simple because it's not enough to init the class. You must use the member function `create(name)`.

## Create

Take the database filename in parameter, after building the class it's initialised in `init()`.

## Init

Open and active the sqlite database.

Then init it with `initDatabase`.

## InitDatabase

This function build the database if she is not or partially build.
Then you can find here all the **TABLE** and the construction of the database.

### OGMsg and DPMsg

`OGMsg` represent the messages sent by the users and `DPMsg` represent the messages sent by the bot from the original messages.

These two tables allow to add cooldown by author by stocking the `id_author` and the `date` of the emission.
It allows also to edit all the duplication if the original message is edited by the user.

The elements of the two tables will be dropped by a count or with a time expiration not defined yet.

### ChannelPartner, Service and ChannelPartnerService

These three tables, work together to assign to a channel (`ChannelPartner`), one or more services (`Service`) link 
together by `ChannelPartnerService`.