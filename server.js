// ======================================================
// CampusPulse Backend
// server.js PART 1
// ======================================================


const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");




// ===============================
// APP SETUP
// ===============================


const app = express();


const server = http.createServer(app);


const wss = new WebSocket.Server({
    server
});



app.use(express.json());

app.use(express.static(
    path.join(__dirname,"public")
));




// ===============================
// UPLOAD FOLDER
// ===============================


if(!fs.existsSync("uploads")){
    fs.mkdirSync("uploads");
}


app.use(
    "/uploads",
    express.static(
        path.join(__dirname,"uploads")
    )
);





// ===============================
// MEMORY DATABASE
// (Replace with Mongo later)
// ===============================


const users = [];


const sessions = new Map();



let messages = [];

let whispers = [];





// ===============================
// POLL DATA
// ===============================


let poll = {

    question:
    "Which campus feature do you want?",


    options:[
        "Events",
        "Study Groups",
        "Marketplace",
        "Clubs"
    ],


    votes:[
        0,
        0,
        0,
        0
    ]

};







// ===============================
// FILE UPLOAD
// ===============================


const storage = multer.diskStorage({

    destination:(req,file,cb)=>{

        cb(
            null,
            "uploads/"
        );

    },


    filename:(req,file,cb)=>{

        const name =
        Date.now()
        +
        "-"
        +
        file.originalname;


        cb(
            null,
            name
        );

    }


});



const upload =
multer({
    storage
});







// ===============================
// HELPERS
// ===============================


function send(ws,data){

    if(
        ws.readyState === WebSocket.OPEN
    ){

        ws.send(
            JSON.stringify(data)
        );

    }

}





function broadcast(data){

    wss.clients.forEach(
        client=>{

            if(
                client.readyState === WebSocket.OPEN
            ){

                client.send(
                    JSON.stringify(data)
                );

            }

        }
    );

}





function getOnlineUsers(){

    let list=[];


    sessions.forEach(
        user=>{

            list.push({

                id:user.id,

                name:user.name,

                role:user.role

            });

        }
    );


    return list;

}





function sendState(ws){


    send(
        ws,
        {

            type:"state",

            users:getOnlineUsers(),

            messages,

            whispers,

            poll

        }
    );


}






function broadcastUsers(){


    broadcast({

        type:"users",

        users:getOnlineUsers()

    });


}







function createID(){


    return Math.random()
    .toString(36)
    .substring(2,12);


}









// ===============================
// WEBSOCKET CONNECTION
// ===============================


wss.on(
"connection",
(ws)=>{


    let current = null;



    console.log(
        "New websocket connection"
    );



    send(
        ws,
        {

            type:"state",

            users:[],

            messages,

            whispers,

            poll

        }
    );





    ws.on(
    "message",
    async(raw)=>{


        let data;


        try{


            data =
            JSON.parse(raw);


        }
        catch{


            return;


        }






        // =====================================
        // SIGNUP
        // =====================================


        if(data.type==="signup"){


            let exists =
            users.find(
                u=>
                u.name===data.name
            );



            if(exists){


                send(
                    ws,
                    {

                    type:"auth_error",

                    message:
                    "Username already exists"

                    }
                );


                return;


            }




            let hash =
            await bcrypt.hash(
                data.password,
                10
            );



            let user={


                id:createID(),


                name:data.name,


                email:data.email,


                password:hash,


                role:"student"


            };



            users.push(user);



            send(
                ws,
                {

                    type:"me",

                    me:{

                        id:user.id,

                        name:user.name,

                        role:user.role

                    }

                }
            );



            current=user;


            sessions.set(
                ws,
                user
            );



            sendState(ws);


            broadcastUsers();


            return;


        }







        // =====================================
        // LOGIN
        // =====================================


        if(data.type==="login"){


            let user;



            if(
                data.name==="Guest"
            ){


                user={

                    id:createID(),

                    name:"Guest",

                    role:"guest"

                };


            }

            else{


                user =
                users.find(
                    u=>
                    u.name===data.name
                );



                if(!user){


                    send(
                        ws,
                        {

                        type:"auth_error",

                        message:
                        "User not found"

                        }
                    );


                    return;


                }



                let ok =
                await bcrypt.compare(
                    data.password,
                    user.password
                );



                if(!ok){


                    send(
                        ws,
                        {

                        type:"auth_error",

                        message:
                        "Wrong password"

                        }
                    );


                    return;


                }



            }



            current=user;



            sessions.set(
                ws,
                user
            );



            send(
                ws,
                {

                type:"me",

                me:{

                    id:user.id,

                    name:user.name,

                    role:user.role

                }

                }
            );



            sendState(ws);


            broadcastUsers();


        }
      // =====================================
// CHAT MESSAGE
// =====================================


if(data.type==="chat"){


    if(!current)
        return;



    let msg={

        id:createID(),

        from:current.id,

        name:current.name,

        text:data.text || "",

        mediaUrl:data.mediaUrl || null,

        mediaType:data.mediaType || null,

        time:new Date()
        .toLocaleTimeString()

    };



    messages.push(msg);



    // keep last 200 messages

    if(messages.length>200){

        messages.shift();

    }



    broadcast({

        type:"chat",

        message:msg

    });


}







// =====================================
// ANONYMOUS WHISPER
// =====================================


if(data.type==="whisper"){


    if(!data.text)
        return;



    let whisper={


        id:createID(),


        text:data.text,


        time:new Date()
        .toLocaleTimeString()


    };



    whispers.push(
        whisper
    );



    if(whispers.length>100){

        whispers.shift();

    }



    broadcast({

        type:"whisper",

        whisper

    });


}








// =====================================
// POLL VOTE
// =====================================


if(data.type==="vote"){


    let index =
    Number(data.index);



    if(
        index >=0 &&
        index < poll.options.length
    ){

        poll.votes[index]++;




        broadcast({

            type:"poll",

            poll

        });


    }


}








// =====================================
// LOGOUT
// =====================================


if(data.type==="logout"){


    sessions.delete(ws);


    current=null;


    broadcastUsers();


}





    });


    // END MESSAGE HANDLER








// =====================================
// DISCONNECT
// =====================================


ws.on(
"close",
()=>{


    sessions.delete(ws);



    broadcastUsers();



    console.log(
        "Client disconnected"
    );



});


});
// ======================================================
// SERVER START
// ======================================================
// ======================================================
// FILE UPLOAD API
// ======================================================

app.post(
"/api/upload",
upload.single("media"),
(req,res)=>{

    if(!req.file){

        return res.status(400).json({
            error:"No file uploaded"
        });

    }


    res.json({

        fileUrl:
        "/uploads/" + req.file.filename,

        fileType:
        req.file.mimetype

    });

});




// ======================================================
// FORGOT PASSWORD API
// ======================================================

app.post(
"/api/forgot-password",
(req,res)=>{

    const email =
    req.body.email;


    const user =
    users.find(
        u=>u.email===email
    );


    if(!user){

        return res.status(404).json({

            error:"Email not registered"

        });

    }


    console.log(
        "Password recovery requested:",
        email
    );


    res.json({

        success:true,

        message:"Recovery mail sent"

    });


});




// ======================================================
// STATUS
// ======================================================

app.get(
"/api/status",
(req,res)=>{

    res.json({

        app:"CampusPulse",

        users:users.length,

        online:sessions.size

    });

});

const PORT =
process.env.PORT || 3000;



server.listen(
PORT,
()=>{


    console.log(
        `
=================================

 CampusPulse Server Running

 URL:
 http://localhost:${PORT}

 WebSocket:
 ws://localhost:${PORT}

=================================
        `
    );


});








// ======================================================
// GLOBAL ERROR HANDLER
// ======================================================


process.on(
"uncaughtException",
(err)=>{


    console.error(
        "SERVER ERROR:",
        err
    );


});



process.on(
"unhandledRejection",
(err)=>{


    console.error(
        "PROMISE ERROR:",
        err
    );


});
