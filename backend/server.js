import express from "express";
import { createServer } from 'http'
import { Server } from 'socket.io'
import { YSocketIO } from 'y-socket.io/dist/server'

const app = express()
const httpserver = createServer(app)

const io = new Server(httpserver, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
})

const ysocketio = new YSocketIO(io)
ysocketio.initialize()


app.get('/', (req, res) => {
    res.status(200).json({
        message: 'hello world',
        success: true,
    })
})

app.get('/health', (req, res) => {
    res.status(200).json({
        message: 'ok',
        success: true,
    })
})

httpserver.listen(5000, () => {
    console.log("server is running on port 5000")
})