# build frontend 
FROM node:22-alpine AS frontend-builder
COPY ./frontend /app

WORKDIR /app

RUN npm install

RUN npm run build 

# build backend 
FROM node:22-alpine

COPY ./backend /app

WORKDIR /app

RUN npm install

COPY --from=frontend-builder /app/dist /app/public

CMD ["node", "server.js"]
