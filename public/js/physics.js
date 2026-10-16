(function (root) {
    const C = {
        FIELD_W: 800,
        FIELD_H: 500,
        PADDLE_W: 40,
        PADDLE_H: 60,
        BALL_SIZE: 24,
        P1_X: 30,
        P2_X: 730,
        MAX_POINTS: 5,
        PADDLE_SPEED: 6,
        BALL_START_SPEED: 4,
        BALL_SPEED_STEP: 0.25,
        BALL_MAX_SPEED: 12,
        MIN_BOUNCE_ANGLE: Math.PI / 18,
        STEP_MS: 1000 / 60,
        COUNTDOWN_STEP_MS: 650,
        POINT_BANNER_MS: 1300,
        SERVE_PAUSE_MS: 900
    };
    C.COUNTDOWN_MS = C.COUNTDOWN_STEP_MS * 3;
    C.POINT_PAUSE_MS = C.POINT_BANNER_MS + C.COUNTDOWN_MS;

    function minVerticalSpeed(ball) {
        return Math.sin(C.MIN_BOUNCE_ANGLE) * ball.speed;
    }

    function bounceAngle(ball, collidePoint) {
        const c = Math.max(-1, Math.min(1, collidePoint));
        let angle = (Math.PI / 4) * c;
        if (Math.abs(angle) < C.MIN_BOUNCE_ANGLE) {
            let dir = Math.sign(c);
            if (dir === 0) dir = ball.y + C.BALL_SIZE / 2 < C.FIELD_H / 2 ? 1 : -1;
            angle = dir * C.MIN_BOUNCE_ANGLE;
        }
        return angle;
    }

    function inPaddleZone(ball, side) {
        if (side === 'p1') return ball.vx < 0 && ball.x <= C.P1_X + C.PADDLE_W && ball.x >= C.P1_X;
        return ball.vx > 0 && ball.x + C.BALL_SIZE >= C.P2_X && ball.x <= C.P2_X + C.PADDLE_W;
    }

    function tryHit(ball, side, paddleY) {
        if (ball.y + C.BALL_SIZE < paddleY || ball.y > paddleY + C.PADDLE_H) return false;
        const collidePoint = ((ball.y + C.BALL_SIZE / 2) - (paddleY + C.PADDLE_H / 2)) / (C.PADDLE_H / 2);
        const angle = bounceAngle(ball, collidePoint);
        ball.speed = Math.min(C.BALL_MAX_SPEED, ball.speed + C.BALL_SPEED_STEP);
        ball.vx = (side === 'p1' ? 1 : -1) * Math.cos(angle) * ball.speed;
        ball.vy = Math.sin(angle) * ball.speed;
        return true;
    }

    function step(ball, paddleY, onEvent) {
        ball.x += ball.vx;
        ball.y += ball.vy;

        if (ball.y <= 0) {
            ball.y = 0;
            ball.vy = Math.max(Math.abs(ball.vy), minVerticalSpeed(ball));
            onEvent('wall');
        } else if (ball.y >= C.FIELD_H - C.BALL_SIZE) {
            ball.y = C.FIELD_H - C.BALL_SIZE;
            ball.vy = -Math.max(Math.abs(ball.vy), minVerticalSpeed(ball));
            onEvent('wall');
        }

        for (const side of ['p1', 'p2']) {
            if (!inPaddleZone(ball, side)) continue;
            const y = paddleY(side);
            if (y === undefined) return false;
            if (tryHit(ball, side, y)) onEvent('hit', side);
        }

        if (ball.x < 0) onEvent('out', 'p2');
        else if (ball.x > C.FIELD_W) onEvent('out', 'p1');
        return true;
    }

    function serveBall(ball, direction, vy) {
        ball.x = C.FIELD_W / 2;
        ball.y = C.FIELD_H / 2;
        ball.speed = C.BALL_START_SPEED;
        ball.vx = direction * ball.speed;
        ball.vy = vy;
    }

    const Physics = { ...C, step, serveBall };
    if (typeof module !== 'undefined' && module.exports) module.exports = Physics;
    else root.Physics = Physics;
})(this);
