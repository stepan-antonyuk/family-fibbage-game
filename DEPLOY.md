# Развёртывание

## Что копировать на сервер

Все файлы **кроме** `node_modules`:

```
server.js
package.json
package-lock.json
public/
```

С локальной машины:

```bash
rsync -av --exclude node_modules ./ user@your-server:~/fibbage/
```

## На сервере

```bash
cd ~/fibbage
npm install --omit=dev
```

## Запуск (pm2)

```bash
npm install -g pm2
PORT=3000 pm2 start server.js --name fibbage
pm2 save
pm2 startup   # выполните команду, которую выведет эта команда
```

Полезные команды pm2:

```bash
pm2 status          # состояние процессов
pm2 logs fibbage    # логи
pm2 restart fibbage # перезапуск после обновления
```

## nginx

Добавьте в конфигурацию вашего сайта (например, `/etc/nginx/sites-available/default`):

```nginx
location /fibbage/ {
    proxy_pass         http://127.0.0.1:3000/;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade    $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host       $host;
    proxy_set_header   X-Real-IP  $remote_addr;
}
```

Проверка и перезагрузка:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Фаервол (EC2 Security Group)

Откройте порт **80** (и **443** если используете HTTPS) в Security Group инстанса.  
Порт 3000 открывать публично **не нужно** — трафик идёт через nginx.

## Обновление

```bash
rsync -av --exclude node_modules ./ user@your-server:~/fibbage/
ssh user@your-server "cd ~/fibbage && npm install --omit=dev && pm2 restart fibbage"
```

## QR-код (необязательно)

Положите файл `public/qr.png` (QR, ведущий на адрес вашего сайта) — хост-страница отобразит его автоматически.
