async function sendLog(client, message = "Error", idMsg) {
    let nTry = 0;
    let success = false;
    while (nTry < 3 && !success) {
        try {
            const owner = await client.users.fetch(process.env.OWNER_ID);
            if (idMsg) {
                idMsg.owner = (await owner.send(message)).id;
            }
            try {
                const admin_channel = await client.channels.fetch(process.env.INFO_SERV);
                if (!admin_channel)
                    return false;
                if (idMsg) {
                    idMsg.admin = (await admin_channel.send(message)).id;
                }
                else {
                    await admin_channel.send(message);
                }
            }
            catch (error) {
                if (error.message == "Missing Access")
                    owner.send("Missing Access to admin channel");
            }
            success = true;
        }
        catch (error) {
            console.error("Erreur while sending to the owner : ", error.message);
        }
        nTry++;
    }
    return (success);
}
export { sendLog };
//# sourceMappingURL=sendLog.js.map