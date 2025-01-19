const test = async(client, interaction) => {
    console.log("I'm working !!");
    await interaction.reply({content: "I'm working !!"});
}

module.exports = test;