docker exec -it `docker ps --format '{{.ID}}' --filter name=suwali-rq_worker` rq info $@
