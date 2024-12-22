async function sendLog(client = null, message = "Error") {
    if (!client) {
        return false;
    }
    let nTry = 0;
    let success = false;
    while (nTry < 10 && success === false) {
        try {
            const owner = await client.users.fetch(process.env.OWNER_ID);
            await owner.send(message);
            try {
                const admin_channel = await client.channels.fetch(process.env.INFO_SERV);
                await admin_channel.send(message);
            } catch (error) {
                if (error.message === "Missing Access")
                    owner.send("Missing Access to admin channel");
            }
            success = true;
        } catch (error) {
            console.log(error);
        }
        nTry++;
    }
    return (success)
}

module.exports = sendLog;