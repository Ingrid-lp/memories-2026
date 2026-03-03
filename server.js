const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');

const multer = require('multer');
const path = require('path');

const app = express();
const port = 3000;

// Configuração do armazenamento do Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); 
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// MIDDLEWARES
app.use(cors());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(bodyParser.json());

// Configurações do seu banco de dados MySQL
const db = mysql.createConnection({
    host: 'wagnerweinert.com.br',
    user: 'info22_ingrid', 
    password: 'info22_ingrid', 
    database: 'info22_ingrid'
});

db.connect(err => {
    if (err) {
        console.error('Erro ao conectar ao MySQL:', err);
        return;
    }
    console.log('Conectado ao MySQL com sucesso!');

    // Cria as tabelas se elas não existirem
    const createUsersTable = `CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL
    )`;
    const createAlbumsTable = `CREATE TABLE IF NOT EXISTS albums (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        userId INT,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )`;
    // ATUALIZADO: REMOVIDA A COLUNA albumId
    const createMemoriesTable = `CREATE TABLE IF NOT EXISTS memories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255),
        description TEXT,
        date VARCHAR(255),
        imageUrl TEXT,
        userId INT,
        sentiment VARCHAR(255) NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )`;
    // NOVO: TABELA DE LIGAÇÃO PARA RELACIONAMENTO MUITOS-PARA-MUITOS
    const createMemoryAlbumsTable = `CREATE TABLE IF NOT EXISTS memory_albums (
        memoryId INT,
        albumId INT,
        PRIMARY KEY (memoryId, albumId),
        FOREIGN KEY (memoryId) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (albumId) REFERENCES albums(id) ON DELETE CASCADE
    )`;

    db.query(createUsersTable, err => { if (err) console.error('Erro ao criar tabela de usuários:', err); });
    db.query(createAlbumsTable, err => { if (err) console.error('Erro ao criar tabela de álbuns:', err); });
    db.query(createMemoriesTable, err => { if (err) console.error('Erro ao criar tabela de memórias:', err); });
    db.query(createMemoryAlbumsTable, err => { if (err) console.error('Erro ao criar tabela de ligação memory_albums:', err); });
});

// Rotas da API para Autenticação (MANTIDAS)
app.post('/register', (req, res) => {
    const { name, email, password } = req.body;
    const query = 'INSERT INTO users (name, email, password) VALUES (?, ?, ?)';
    db.query(query, [name, email, password], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ message: 'Email já cadastrado.' });
            }
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: 'Conta criada com sucesso!' });
    });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const query = 'SELECT id, name FROM users WHERE email = ? AND password = ?';
    db.query(query, [email, password], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length > 0) {
            res.json({ user: { id: results[0].id, name: results[0].name } });
        } else {
            res.status(401).json({ message: 'Email ou senha incorretos.' });
        }
    });
});

// Rotas da API para Memórias

// ATUALIZADO: Buscar memórias e seus IDs de álbum associados (para o frontend)
app.get('/memories/:userId', (req, res) => {
    const { userId } = req.params;
    const query = 'SELECT m.*, GROUP_CONCAT(ma.albumId) as albumIds FROM memories m LEFT JOIN memory_albums ma ON m.id = ma.memoryId WHERE m.userId = ? GROUP BY m.id';
    db.query(query, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        const formattedResults = results.map(m => ({
            ...m,
            albumIds: m.albumIds ? m.albumIds.split(',').map(id => Number(id)) : []
        }));
        res.json(formattedResults);
    });
});

// ATUALIZADO: Lógica de POST com validação de Sentimento
app.post('/memories', upload.single('memoryImage'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'O ficheiro da memória (imagem) é obrigatório.' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    
    const { title, description, date, userId, sentiment } = req.body;
    
    // NOVO: VALIDAÇÃO DE SENTIMENTO OBRIGATÓRIO
    if (!sentiment || sentiment.trim() === '') {
        return res.status(400).json({ message: 'O campo Sentimento é obrigatório.' });
    }

    // QUERY sem albumId
    const query = 'INSERT INTO memories (title, description, date, imageUrl, userId, sentiment) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(query, [title, description, date, imageUrl, userId, sentiment], (err, result) => {
        if (err) {
            console.error('Erro ao inserir no banco de dados:', err);
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ 
            id: result.insertId, 
            imageUrl: imageUrl, 
            message: 'Memória adicionada com sucesso!' 
        });
    });
});

// ATUALIZADO: Rota PUT AGORA SÓ ATUALIZA METADADOS (sem albumId)
app.put('/memories/:id', (req, res) => {
    const { id } = req.params;
    const { title, description, date, sentiment } = req.body; 

    // NOVO: VALIDAÇÃO DE SENTIMENTO NA EDIÇÃO
     if (!sentiment || sentiment.trim() === '') {
        return res.status(400).json({ message: 'O campo Sentimento é obrigatório.' });
    }

    const query = 'UPDATE memories SET title = ?, description = ?, date = ?, sentiment = ? WHERE id = ?';
    const params = [title, description, date, sentiment, id];

    db.query(query, params, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Memória não encontrada.' });
        }
        res.json({ message: 'Memória atualizada com sucesso!' });
    });
});

app.delete('/memories/:id', (req, res) => {
    const { id } = req.params;
    const query = 'DELETE FROM memories WHERE id = ?';
    db.query(query, [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Memória não encontrada.' });
        }
        res.json({ message: 'Memória excluída com sucesso!' });
    });
});


// NOVO: Rotas para a nova tabela de ligação (memory_albums)

app.post('/memory_albums', (req, res) => {
    const { memoryId, albumId } = req.body;
    const query = 'INSERT INTO memory_albums (memoryId, albumId) VALUES (?, ?)';
    db.query(query, [memoryId, albumId], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ message: 'Memória já está neste álbum.' });
            }
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: 'Memória adicionada ao álbum com sucesso!' });
    });
});

app.delete('/memory_albums/:memoryId/:albumId', (req, res) => {
    const { memoryId, albumId } = req.params;
    const query = 'DELETE FROM memory_albums WHERE memoryId = ? AND albumId = ?';
    db.query(query, [memoryId, albumId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Ligação não encontrada.' });
        }
        res.json({ message: 'Memória removida do álbum com sucesso!' });
    });
});


// Rotas da API para Álbuns (MANTIDAS)
app.get('/albums/:userId', (req, res) => {
    const { userId } = req.params;
    const query = 'SELECT * FROM albums WHERE userId = ?';
    db.query(query, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/albums', (req, res) => {
    const { title, userId } = req.body;
    const query = 'INSERT INTO albums (title, userId) VALUES (?, ?)';
    db.query(query, [title, userId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: result.insertId, message: 'Álbum criado com sucesso!' });
    });
});

app.put('/albums/:id', (req, res) => {
    const { id } = req.params;
    const { title } = req.body;
    const query = 'UPDATE albums SET title = ? WHERE id = ?';
    db.query(query, [title, id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Álbum não encontrado.' });
        }
        res.json({ message: 'Álbum atualizado com sucesso!' });
    });
});

app.delete('/albums/:id', (req, res) => {
    const { id } = req.params;
    const query = 'DELETE FROM albums WHERE id = ?';
    db.query(query, [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Álbum não encontrado.' });
        }
        res.json({ message: 'Álbum excluída com sucesso!' });
    });
});

// NOVO: Rota para buscar contagens de sentimentos por usuário
app.get('/sentiments/:userId', (req, res) => {
    const { userId } = req.params;
    // Consulta SQL que agrupa e conta as memórias por sentimento para o usuário
    const query = 'SELECT sentiment, COUNT(*) as count FROM memories WHERE userId = ? GROUP BY sentiment';
    db.query(query, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        // Retorna um array de objetos: [{ sentiment: 'Felicidade', count: 5 }, ...]
        res.json(results);
    });
});

app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});