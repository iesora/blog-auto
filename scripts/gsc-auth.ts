/**
 * Google Search Console 用のリフレッシュトークン取得スクリプト（ワンタイム）。
 *
 * 使い方:
 *   npx ts-node scripts/gsc-auth.ts <OAuth client_secret JSON のパス>
 *
 * 流れ:
 *   1. ローカル HTTP サーバを 127.0.0.1:53682 で起動
 *   2. ブラウザで Google の同意画面を開いてもらう
 *   3. リダイレクトで戻ってきた認可コードを access/refresh token に交換
 *   4. ターミナルに env に貼る用の行を表示
 */
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { OAuth2Client } from 'google-auth-library';
import { URL } from 'url';

const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];
const HOST = '127.0.0.1';
const PORT = 53682;
const REDIRECT_URI = `http://${HOST}:${PORT}/oauth2callback`;

async function main(): Promise<void> {
  const clientJsonPath = process.argv[2];
  if (!clientJsonPath) {
    console.error(
      'Usage: npx ts-node scripts/gsc-auth.ts <client_secret JSON>',
    );
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(clientJsonPath, 'utf-8'));
  const creds = raw.web ?? raw.installed;
  if (!creds?.client_id || !creds?.client_secret) {
    console.error(
      'JSON に web / installed 形式の client_id / client_secret が見つかりません',
    );
    process.exit(1);
  }

  const oauth2 = new OAuth2Client(
    creds.client_id,
    creds.client_secret,
    REDIRECT_URI,
  );

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('\n以下の URL をブラウザで開いて、Search Console の所有者アカウントで認証してください:\n');
  console.log(authUrl);
  console.log(
    `\n認証後、ブラウザは ${REDIRECT_URI} にリダイレクトされ、このスクリプトが自動で続きを処理します。\n`,
  );

  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
        if (url.pathname !== '/oauth2callback') {
          res.writeHead(404).end();
          return;
        }
        const err = url.searchParams.get('error');
        if (err) {
          res
            .writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            .end(`<h2>認証エラー: ${err}</h2>`);
          server.close();
          reject(new Error(`OAuth error: ${err}`));
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400).end('Missing code');
          return;
        }

        const { tokens } = await oauth2.getToken(code);
        res
          .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          .end('<h2>認証完了。ターミナルに戻ってください。</h2>');

        if (!tokens.refresh_token) {
          console.error(
            '\nrefresh_token が返ってきませんでした。一度 https://myaccount.google.com/permissions でこのアプリのアクセス権を取り消してから再実行してください。',
          );
          server.close();
          reject(new Error('No refresh_token'));
          return;
        }

        console.log('\n===== 取得結果 =====');
        console.log(`GSC_OAUTH_CLIENT_ID=${creds.client_id}`);
        console.log(`GSC_OAUTH_CLIENT_SECRET=${creds.client_secret}`);
        console.log(`GSC_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log('\n上記 3 行を .env に追加して、サーバを再起動してください。\n');

        server.close();
        resolve();
      } catch (e) {
        res.writeHead(500).end(String(e));
        server.close();
        reject(e);
      }
    });
    server.listen(PORT, HOST, () => {
      console.log(`Waiting for OAuth callback on ${REDIRECT_URI} ...`);
    });
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
