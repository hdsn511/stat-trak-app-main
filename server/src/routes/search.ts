import { Router } from 'express';
import { searchEntities } from '../controllers/searchController';

const router = Router();

router.get('/', searchEntities);

export default router;
