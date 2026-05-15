const express = require('express');
const { pool } = require('../db');
const authenticate = require('../middleware/auth');

const router = express.Router();

// all routes need authentication
router.use(authenticate);

// helper to shape note response
function formatNote(note) {
  if (!note) return null;
  return {
    id: String(note.id),
    title: note.title,
    content: note.content,
    is_pinned: note.is_pinned || false,
    created_at: note.created_at,
    updated_at: note.updated_at
  };
}

// helper - check if user has access to a note (either owner or shared with them)
async function checkAccess(noteId, userId) {
  const owner = await pool.query(
    'SELECT id FROM notes WHERE id = $1 AND user_id = $2',
    [noteId, userId]
  );
  if (owner.rows.length > 0) return 'owner';

  const shared = await pool.query(
    'SELECT id FROM note_shares WHERE note_id = $1 AND shared_with_user_id = $2',
    [noteId, userId]
  );
  if (shared.rows.length > 0) return 'shared';

  return null;
}

// GET /notes - get all notes for the logged in user
// also supports pagination via ?page=1&limit=20
router.get('/', async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 20;

    if (page < 1) page = 1;
    if (limit < 1 || limit > 100) limit = 20;

    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT id, title, content, is_pinned, created_at, updated_at
       FROM notes
       WHERE user_id = $1
       ORDER BY is_pinned DESC, updated_at DESC
       LIMIT $2 OFFSET $3`,
      [req.userId, limit, offset]
    );

    const notes = result.rows.map(formatNote);
    return res.status(200).json(notes);
  } catch (err) {
    console.error("Error in GET /notes:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
});

// GET /notes/:id
router.get('/:id', async (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    if (isNaN(noteId)) {
      return res.status(400).json({ message: "Invalid note id" });
    }

    const access = await checkAccess(noteId, req.userId);
    if (!access) {
      return res.status(404).json({ message: "Note not found" });
    }

    const result = await pool.query('SELECT * FROM notes WHERE id = $1', [noteId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Note not found" });
    }

    return res.status(200).json(formatNote(result.rows[0]));
  } catch (err) {
    console.error("Error in GET /notes/:id :", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
});

// POST /notes - create a new note
router.post('/', async (req, res) => {
  try {
    const { title, content } = req.body || {};

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({ message: "Title is required" });
    }

    if (title.length > 255) {
      return res.status(400).json({ message: "Title is too long (max 255 chars)" });
    }

    const noteContent = (typeof content === 'string') ? content : '';

    const result = await pool.query(
      `INSERT INTO notes (user_id, title, content)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.userId, title.trim(), noteContent]
    );

    return res.status(201).json(formatNote(result.rows[0]));
  } catch (err) {
    console.error("Error in POST /notes:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
});

// PUT /notes/:id - update an existing note (only owner can do this)
router.put('/:id', async (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    if (isNaN(noteId)) {
      return res.status(400).json({ message: "Invalid note id" });
    }

    const { title, content } = req.body || {};

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({ message: "Title is required" });
    }

    if (title.length > 255) {
      return res.status(400).json({ message: "Title is too long (max 255 chars)" });
    }

    const noteContent = (typeof content === 'string') ? content : '';

    // make sure the note belongs to this user
    const check = await pool.query(
      'SELECT id FROM notes WHERE id = $1 AND user_id = $2',
      [noteId, req.userId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ message: "Note not found" });
    }

    const result = await pool.query(
      `UPDATE notes
       SET title = $1, content = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [title.trim(), noteContent, noteId]
    );

    return res.status(200).json(formatNote(result.rows[0]));
  } catch (err) {
    console.error("Error in PUT /notes/:id :", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
});

// DELETE /notes/:id
router.delete('/:id', async (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    if (isNaN(noteId)) {
      return res.status(400).json({ message: "Invalid note id" });
    }

    const result = await pool.query(
      'DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id',
      [noteId, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Note not found" });
    }

    return res.status(204).send();
  } catch (err) {
    console.error("Error in DELETE /notes/:id :", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
});

// POST /notes/:id/share - share a note with another user
router.post('/:id/share', async (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    if (isNaN(noteId)) {
      return res.status(400).json({ message: "Invalid note id" });
    }

    const { share_with_email } = req.body || {};
    if (!share_with_email || typeof share_with_email !== 'string') {
      return res.status(400).json({ message: "share_with_email is required" });
    }

    const targetEmail = share_with_email.trim().toLowerCase();

    // check the note exists and current user is the owner
    const noteResult = await pool.query(
      'SELECT id FROM notes WHERE id = $1 AND user_id = $2',
      [noteId, req.userId]
    );
    if (noteResult.rows.length === 0) {
      return res.status(404).json({ message: "Note not found" });
    }

    // find target user
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [targetEmail]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User to share with not found" });
    }

    const targetUserId = userResult.rows[0].id;

    // can't share with yourself
    if (targetUserId === req.userId) {
      return res.status(400).json({ message: "You cannot share a note with yourself" });
    }

    // try to insert the share record
    try {
      await pool.query(
        'INSERT INTO note_shares (note_id, shared_with_user_id) VALUES ($1, $2)',
        [noteId, targetUserId]
      );
    } catch (e) {
      // 23505 = unique_violation -> already shared
      if (e.code === '23505') {
        return res.status(200).json({ message: "Note is already shared with this user" });
      }
      throw e;
    }

    return res.status(200).json({ message: "Note shared successfully" });
  } catch (err) {
    console.error("Error in POST /notes/:id/share :", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
});

// PATCH /notes/:id/pin - my custom feature: pin a note
router.patch('/:id/pin', async (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    if (isNaN(noteId)) {
      return res.status(400).json({ message: "Invalid note id" });
    }

    const result = await pool.query(
      `UPDATE notes SET is_pinned = TRUE, updated_at = updated_at
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [noteId, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Note not found" });
    }

    return res.status(200).json(formatNote(result.rows[0]));
  } catch (err) {
    console.error("Error pinning note:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
});

// PATCH /notes/:id/unpin - unpin a note
router.patch('/:id/unpin', async (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    if (isNaN(noteId)) {
      return res.status(400).json({ message: "Invalid note id" });
    }

    const result = await pool.query(
      `UPDATE notes SET is_pinned = FALSE, updated_at = updated_at
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [noteId, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Note not found" });
    }

    return res.status(200).json(formatNote(result.rows[0]));
  } catch (err) {
    console.error("Error unpinning note:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
});

module.exports = router;
