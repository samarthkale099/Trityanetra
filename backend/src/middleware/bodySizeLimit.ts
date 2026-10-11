import express from 'express';

export const bodySizeLimit = express.json({ limit: '1mb' });
