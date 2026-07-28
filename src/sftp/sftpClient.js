// ============================================================
// src/sftp/sftpClient.js
// Classe responsável por conectar a um servidor via SFTP e
// executar upload/download de arquivos entre a máquina local
// e o servidor remoto.
//
// Usa o pacote "ssh2-sftp-client", que é um wrapper baseado em
// Promises sobre o pacote "ssh2".
//
// Esta classe emite eventos ('progress', 'done', 'error') que
// o main.js escuta e repassa para a interface via IPC.
// ============================================================

const SftpClientLib = require('ssh2-sftp-client');
const EventEmitter = require('node:events');
const fs = require('node:fs/promises');

class SftpHelper extends EventEmitter {
    constructor() {
        super();

        // Instância real do cliente SFTP (biblioteca externa).
        this.sftp = new SftpClientLib();

        // Guarda se a conexão está ativa, para evitar chamadas
        // repetidas de connect() ou operações após desconectar.
        this.isConnected = false;
    }

    // ----------------------------------------------------------
    // Conecta ao servidor usando os dados salvos (host, porta,
    // usuário e caminho da chave privada).
    //
    // server = { host, port, username, keyPath, passphrase? }
    // ----------------------------------------------------------
    async connect(server, hostVerifier, onKeyboardInteractive) {
        if (!server || typeof server !== 'object') {
            throw new Error('Dados do servidor inválidos.');
        }

        if (typeof server.host !== 'string' || server.host.trim() === '') {
            throw new Error('Host do servidor inválido.');
        }

        if (typeof server.username !== 'string' || server.username.trim() === '') {
            throw new Error('Usuário do servidor inválido.');
        }

        const hasKeyPath = typeof server.keyPath === 'string' && server.keyPath.trim() !== '';
        const hasPassword = typeof server.password === 'string' && server.password !== '';

        if (!hasKeyPath && !hasPassword) {
            throw new Error(
                'Configure uma chave privada ou informe a senha (editando o servidor) para conectar via SFTP.'
            );
        }

        // Lê a chave privada do caminho informado (nunca gravamos
        // o conteúdo da chave no servers.json, só o caminho).
        let privateKey;
        if (hasKeyPath) {
            try {
                privateKey = await fs.readFile(server.keyPath);
            } catch {
                throw new Error('Não foi possível ler o arquivo da chave privada informada.');
            }
        }

        // Valida a porta informada no cadastro. Como nenhum dos seus
        // servidores usa a porta padrão 22, essa validação garante
        // que a porta cadastrada seja sempre usada corretamente e
        // impede a conexão com uma porta inválida ou vazia.
        const port = Number(server.port);

        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error('Informe uma porta válida entre 1 e 65535.');
        }

        const config = {
            host: server.host,
            port,
            username: server.username,
            // Autenticação: chave privada quando houver; senão, a senha
            // mantida só em memória durante a sessão (nunca persistida).
            privateKey,
            password: !hasKeyPath && hasPassword ? server.password : undefined,
            // Se a chave tiver senha, ela deve vir do formulário
            // ou de uma variável de ambiente, nunca fixa no código.
            passphrase: server.passphrase || undefined,
            // 90s (e não 10s): servidores com 2FA pedem o código do
            // autenticador durante o handshake — o usuário precisa de
            // tempo para digitar antes do timeout.
            readyTimeout: 90000,
            // Verificação de identidade do servidor (TOFU/known_hosts),
            // fornecida pelo main.js — recusa o handshake em mismatch.
            hostVerifier,
        };

        // Suporte a 2FA (Google Authenticator via PAM): o ssh2 emite
        // 'keyboard-interactive' no cliente subjacente; repassamos os
        // prompts para o main.js, que pergunta o código à interface e
        // devolve a resposta pelo callback `respond`.
        let kbdHandler = null;
        if (typeof onKeyboardInteractive === 'function') {
            config.tryKeyboard = true;
            kbdHandler = (_name, _instructions, _lang, prompts, finish) => {
                onKeyboardInteractive(
                    prompts.map((p) => p.prompt),
                    (answers) => {
                        try {
                            finish(answers);
                        } catch {
                            // Conexão pode ter caído no meio — ignora.
                        }
                    }
                );
            };
            this.sftp.client.on('keyboard-interactive', kbdHandler);
        }

        try {
            await this.sftp.connect(config);
        } finally {
            if (kbdHandler) {
                this.sftp.client.removeListener('keyboard-interactive', kbdHandler);
            }
        }
        this.isConnected = true;
        this.emit('connected', {
            host: server.host,
            port: config.port
        });
    }
    // ----------------------------------------------------------
    // Envia um arquivo da máquina local para o servidor.
    //
    // Usa um caminho temporário (.part) durante a transferência.
    // Só renomeia para o nome final quando o upload terminar por
    // completo — assim, se a conexão cair no meio do processo,
    // você nunca fica com um arquivo remoto corrompido com o
    // nome final.
    // ----------------------------------------------------------
    async uploadFile(localPath, remotePath, transferId) {
        this._ensureConnected();
        this._validatePath(localPath, 'Caminho local');
        this._validatePath(remotePath, 'Caminho remoto');

        const temporaryRemotePath = `${remotePath}.part`;

        try {
            await this.sftp.fastPut(localPath, temporaryRemotePath, {
                // "step" é chamado várias vezes durante a transferência,
                // permitindo atualizar a barra de progresso sem travar
                // a interface (a transferência roda de forma assíncrona).
                step: (transferred, _chunk, total) => {
                    const percent = total > 0 ? Math.round((transferred / total) * 100) : 0;
                    this.emit('progress', {
                        transferId,
                        type: 'upload',
                        localPath,
                        remotePath,
                        transferred,
                        total,
                        percent,
                    });
                },
            });

            // Só renomeia depois que o upload terminou com sucesso.
            await this.sftp.rename(temporaryRemotePath, remotePath);

            this.emit('done', {
                transferId,
                type: 'upload',
                localPath,
                remotePath
            });
        } catch (error) {
            // Se algo falhar, tenta limpar o arquivo temporário
            // para não deixar lixo no servidor.
            await this._safeDelete(temporaryRemotePath);
            this.emit('error', {
                transferId,
                type: 'upload',
                message: error.message
            });
            throw error;
        }
    }

    // ----------------------------------------------------------
    // Baixa um arquivo do servidor para a máquina local.
    //
    // Mesmo princípio do upload: baixa para um arquivo temporário
    // local e só renomeia para o nome final ao concluir.
    // ----------------------------------------------------------
    async downloadFile(remotePath, localPath, transferId) {
        this._ensureConnected();
        this._validatePath(remotePath, 'Caminho remoto');
        this._validatePath(localPath, 'Caminho local');

        const temporaryLocalPath = `${localPath}.part`;

        try {
            await this.sftp.fastGet(remotePath, temporaryLocalPath, {
                step: (transferred, _chunk, total) => {
                    const percent = total > 0 ? Math.round((transferred / total) * 100) : 0;
                    this.emit('progress', {
                        transferId,
                        type: 'download',
                        remotePath,
                        localPath,
                        transferred,
                        total,
                        percent,
                    });
                },
            });

            // Renomeia localmente só depois que o download terminou.
            await fs.rename(temporaryLocalPath, localPath);

            this.emit('done', {
                transferId,
                type: 'download',
                remotePath,
                localPath
            });
        } catch (error) {
            await this._safeDeleteLocal(temporaryLocalPath);
            this.emit('error', {
                transferId,
                type: 'download',
                message: error.message
            });
            throw error;
        }
    }

    // ----------------------------------------------------------
    // Lista o conteúdo de uma pasta remota (sob demanda).
    // Não lista recursivamente — só a pasta pedida, para não
    // travar a interface com diretórios muito grandes.
    // ----------------------------------------------------------
    async listRemoteDir(remotePath) {
        this._ensureConnected();
        this._validatePath(remotePath, 'Caminho remoto');
        const items = await this.sftp.list(remotePath);

        // Retorna só os campos que a interface realmente precisa.
        return items.map((item) => ({
            name: item.name,
            type: item.type, // 'd' para diretório, '-' para arquivo
            size: item.size,
            modifyTime: item.modifyTime,
        }));
    }

    // ----------------------------------------------------------
    // Resolve a pasta "home" real do usuário no servidor (via SFTP
    // realpath('.')). Usado como pasta inicial quando o cadastro do
    // servidor não define uma "pasta remota inicial" — sem isso, o
    // gerenciador de arquivos abria na raiz ("/") em vez da pasta
    // onde os arquivos do usuário realmente ficam.
    // ----------------------------------------------------------
    async getHomeDirectory() {
        this._ensureConnected();
        try {
            const home = await this.sftp.cwd();
            return home || '/';
        } catch {
            return '/';
        }
    }

    // ----------------------------------------------------------
    // Encerra a conexão SFTP.
    // ----------------------------------------------------------
    async disconnect() {
        if (this.isConnected) {
            await this.sftp.end();
            this.isConnected = false;
            this.emit('disconnected');
        }
    }

    // ----------------------------------------------------------
    // Funções auxiliares internas (não são chamadas pelo main.js)
    // ----------------------------------------------------------

    _ensureConnected() {
        if (!this.isConnected) {
            throw new Error('Conexão SFTP não está ativa. Chame connect() primeiro.');
        }
    }

    // Recusa caminhos vazios, não-string ou com byte nulo (usado em
    // alguns ataques de truncamento de caminho contra APIs nativas).
    _validatePath(value, label) {
        if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
            throw new Error(`${label} inválido.`);
        }
    }

    async _safeDelete(remotePath) {
        try {
            await this.sftp.delete(remotePath);
        } catch {
            // Ignora erro: o arquivo temporário pode não existir.
        }
    }

    async _safeDeleteLocal(localPath) {
        try {
            await fs.unlink(localPath);
        } catch {
            // Ignora erro: o arquivo temporário pode não existir.
        }
    }
}

module.exports = SftpHelper;