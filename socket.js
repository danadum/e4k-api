
const WebSocket = require('ws');
const commands = require('./commands.json');

const NOM_UTILISATEUR = process.env.NOM_UTILISATEUR;
const MOT_DE_PASSE = process.env.MOT_DE_PASSE;

function compare_mess_resp(mess, resp) {
    if (mess.command != resp.command) {
        return false;
    }
    if (mess.command in commands) {
        for (let [mess_key, resp_key] of Object.entries(commands[mess.command])) {
            if (mess_key in mess.headers) {
                let mess_val = mess.headers[mess_key];
                let resp_val = resp_key.split('.').reduce((o, k) => o && o[k], resp.content)
                if (typeof(mess_val) == "string" && typeof(resp_val) == "string") {
                    if (mess_val.toLowerCase() != resp_val.toLowerCase()) {
                        return false;
                    }
                }
                else if (mess_val != resp_val) {
                    return false;
                }
            }
        }    
    }
    else {
        for (header in mess.headers) {
            if (mess.headers[header] == resp.content[header]) {
                return false;
            }
        }
    }
    return true;
}

function connect(servers, header) {
    let socket = servers[header].socket = new WebSocket(servers[header].url);
    socket.addEventListener('open', (event) => {
        console.log(`### socket ${header} connected ###`)
        socket.send(`<msg t='sys'><body action='login' r='0'><login z='${header}'><nick><![CDATA[]]></nick><pword><![CDATA[1065004%fr%0]]></pword></login></body></msg>`);
        socket.send(`%xt%${header}%core_lga%1%{"NM": "${NOM_UTILISATEUR}", "PW": "${MOT_DE_PASSE}", "L": "fr", "AID": "1674256959939529708", "DID": 5, "PLFID": "3", "ADID": "null", "AFUID": "appsFlyerUID", "IDFV": "null"}%`);
    });

    socket.addEventListener('message', async (event) => {
        let response = event.data.toString().split("%");
        response = {server: header, command: response[2], return_code: response[4], content: response[5]};
        try {
            response.content = JSON.parse(response.content ?? "{}");
        }
        catch {}
        if (response.command == "core_lga") {
            if (response.return_code == "10005") {
                ping_socket(socket, header);
            }
            else if (response.return_code == "10011") {
                socket.send(`%xt%${header}%core_reg%1%{"NM": "${NOM_UTILISATEUR}", "PW": "${MOT_DE_PASSE}", "L": "fr", "AID": "1674256959939529708", "DID": 5, "PLFID": "3", "ADID": "null", "AFUID": "appsFlyerUID", "IDFV": "null"}%`);
            }
            else {
                socket.close();
            }
        }
        else if (response.command == "core_reg") {
            if (response.return_code == "10005") {
                ping_socket(socket, header);
            }
            else {
                servers[header].reconnect = false;
                socket.close();
            }
        }
        else {
            if (servers[header].messages.some(message => compare_mess_resp(message, response))) {
                servers[header].responses.push(response);
            }
        }
    });

    socket.addEventListener('error', (event) => {
        console.log(`### error in socket ${header} ###`);
        console.log(event.message);
        if (["ENOTFOUND", "ETIMEDOUT"].includes(event.error.code)) {
            servers[header].reconnect = false;
        }
        socket.close();
    });

    socket.addEventListener('close', (event) => {
        console.log(`### socket ${header} closed ${servers[header].reconnect ? "" : "permanently "}###`);
        if (servers[header].reconnect) {
            setTimeout(() => connect(servers, header), 10000);
        }
        else {
            delete servers[header];
        }
    });
}

async function getSocketResponse(servers, message, nb_try) {
    if (nb_try < 20) {
        let response;
        response = servers[message.server].responses.find(response => compare_mess_resp(message, response));
        if (response != undefined) {
            servers[response.server].responses.splice(servers[response.server].responses.indexOf(response), 1);
            servers[message.server].messages.splice(servers[message.server].messages.indexOf(message), 1);
            return response;    
        }
        else {
            return await new Promise(resolve => setTimeout(() => resolve(getSocketResponse(servers, message, nb_try + 1)), 50))
        }
    }
    else {
        servers[message.server].messages.splice(servers[message.server].messages.indexOf(message), 1);
        return {server: message.server, command: message.command, return_code: "-1", content: {}};
    }
}

function ping_socket(socket, header) {
    if (socket.readyState != WebSocket.CLOSED && socket.readyState != WebSocket.CLOSING) {
        socket.send(`%xt%${header}%pin%1%<RoundHouseKick>%`);
        setTimeout(() => ping_socket(socket, header), 60000);
    }
}

module.exports = { connect, getSocketResponse };
