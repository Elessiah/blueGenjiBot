async function sendLog(client = null, message = "Error", idMsg = null) {
    if (!client) {
        return false;
    }
    let nTry = 0;
    let success = false;
    while (nTry < 3 && success === false) {
        try {
            const owner = await client.users.fetch(process.env.OWNER_ID);
            if (idMsg) {
                idMsg.owner = await owner.send(message);
            }
            try {
                const admin_channel = await client.channels.fetch(process.env.INFO_SERV);
                if (idMsg) {
                    idMsg.admin = await admin_channel.send(message);
                    idMsg.admin = idMsg.admin.id;
                } else {
                    await admin_channel.send(message);
                }
            } catch (error) {
                if (error.message === "Missing Access")
                    owner.send("Missing Access to admin channel");
            }
            success = true;
        } catch (error) {
            console.error(error);
        }
        nTry++;
    }
    return (success)
}

module.exports = sendLog;