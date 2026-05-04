import { Router, type IRouter } from "express";
import healthRouter from "./health";
import inputsRouter from "./inputs";
import uploadRouter from "./upload";
import youtubeRouter from "./youtube";
import nodesRouter from "./nodes";
import edgesRouter from "./edges";
import actionsRouter from "./actions";
import graphRouter from "./graph";

const router: IRouter = Router();

router.use(healthRouter);
// upload + youtube must come before the generic :id routes
router.use(uploadRouter);
router.use(youtubeRouter);
router.use(inputsRouter);
router.use(nodesRouter);
router.use(edgesRouter);
router.use(actionsRouter);
router.use(graphRouter);

export default router;
