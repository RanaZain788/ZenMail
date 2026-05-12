try {
    console.log("Ninja Mail khul rahi hai...");
    await page.goto('https://tempmail.ninja/', { waitUntil: 'networkidle2', timeout: 60000 });

    // 1. Wait for the email span
    const emailSelector = '.main-email'; 
    await page.waitForSelector(emailSelector, { timeout: 60000 });

    // 2. Extract the reversed email text
    const reversedEmail = await page.$eval(emailSelector, el => el.innerText);
    console.log("Ulta email mila:", reversedEmail);

    // 3. Email ko seedha karo (Logic: reverse the string)
    const originalEmail = reversedEmail.split("").reverse().join("");
    console.log("Dhamaka! Seedha email:", originalEmail);

    if (originalEmail && originalEmail.includes('@')) {
        // 4. Firebase mein save karo
        await db.ref('active_mails/' + orderData.userId).set({
            email: originalEmail,
            status: 'active',
            timestamp: admin.database.ServerValue.TIMESTAMP
        });
    } else {
        throw new Error("Email sahi se extract nahi hua.");
    }

} catch (err) {
    console.log("Error: " + err.message);
    await page.screenshot({ path: 'error.png' });
}
