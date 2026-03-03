# Deploy no Servidor (PM2 + NGINX)

Este guia explica como configurar a aplication **Trading Cossa** em um servidor Linux (Ubuntu/Debian) para produção, utilizando **PM2** para manter o backend online e **Nginx** como proxy reverso para os WebSockets e para servir o Frontend.

## 1. Preparação (Build)

Antes de rodar em produção, certifique-se de realizar o build de ambos os projetos.

### Frontend (Vite/React)
```bash
cd client
npm install
npm run build
```
Isso irá gerar a pasta `client/dist/` com todos os ficheiros estáticos prontos para produção.

### Backend (NestJS)
```bash
cd backend-nest
npm install
npm run build
```
Isso compilará o código TypeScript para `backend-nest/dist/`.

---

## 2. Iniciar o Backend com PM2

O PM2 é um gerenciador de processos para Node.js.  Você pode inicializar o **NestJS** e garantir que ele reinicie automaticamente caso caia ou o servidor reinicie.

1. Instale o PM2 globalmente:
```bash
npm install -g pm2
```

2. Na raiz do `backend-nest`, crie um arquivo chamado `ecosystem.config.js` (opcional, mas recomendado para gestão avançada) ou inicie diretamente:

**Comando Direto:**
```bash
cd backend-nest
pm2 start dist/main.js --name "trading-cossa-api"
```

**Comando ecosystem.config.js (Opcional):**
```javascript
// backend-nest/ecosystem.config.js
module.exports = {
  apps : [{
    name   : "trading-cossa-api",
    script : "./dist/main.js",
    env_production: {
       NODE_ENV: "production",
       PORT: 3000
    }
  }]
}
```
E então inicie: `pm2 start ecosystem.config.js --env production`

3. **Salvar o processo para iniciar com o servidor (Startup script):**
```bash
pm2 startup
# (Execute o comando que o pm2 imprimir no terminal, começará com "sudo env PATH...")
pm2 save
```

---

## 3. Configurar o NGINX

O Nginx vai servir dois papéis essenciais:
1. **Servidor de Ficheiros Estáticos:** Servir o Frontend (`client/dist`).
2. **Reverse Proxy & WebSockets:** Redirecionar as chamadas à API (`/api`) e o tráfego do WebSocket (`socket.io` do NestJS e Gateways MT5) para o backend rodando na porta `3000` (ou a porta configurada no seu `.env`).

**Aviso:** Substitua `SEU_DOMINIO.com` pelo seu domínio real e `/caminho/absoluto/do/projeto/` pelo local real do seu projeto no Linux (ex: `/var/www/trading-cossa/`).

### Arquivo de Bloco de Servidor (Server Block)

Crie o arquivo no Nginx:
```bash
sudo nano /etc/nginx/sites-available/trading-cossa
```

**Cole a seguinte configuração:**

```nginx
server {
    listen 80;
    server_name SEU_DOMINIO.com www.SEU_DOMINIO.com;

    # 1. Servir o Frontend (Vite React Build)
    root /caminho/absoluto/do/projeto/client/dist;
    index index.html;

    # Para SPA (Single Page Applications) como o React Route Dom
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 2. Configurar o Proxy para o Backend (NestJS /api)
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # Headers para IP Real do Cliente
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 3. Configurar Proxy para WebSockets (Socket.IO do Mt5Gateway)
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade"; # Essencial para WS
        proxy_set_header Host $host;
        
        # Prevenir timeouts longos cortando a conexão
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

### Ativar e Reiniciar o Nginx

1. Habilite a configuração:
```bash
sudo ln -s /etc/nginx/sites-available/trading-cossa /etc/nginx/sites-enabled/
```

2. Teste a sintaxe do Nginx para garantir que não há erros:
```bash
sudo nginx -t
```

3. Reinicie o serviço do Nginx:
```bash
sudo systemctl restart nginx
```

## 4. SSL / HTTPS (Let's Encrypt - Recomendado)
Se o seu domínio já estiver apontando para a máquina, use o **Certbot** para gerar certificados HTTPS gratuitos automaticamente. O WebSocket **exige** `wss://` caso o site esteja em `https://`. O certbot configurará o `nginx` automaticamente para você.

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d SEU_DOMINIO.com -d www.SEU_DOMINIO.com
```
