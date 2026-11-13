-- =====================================================================
-- Aula: por qué un estudiante no ve sus cursos y evaluaciones, y reparación
-- 1) Vincula automáticamente la ficha con la cuenta del mismo correo (al entrar)
-- 2) Informe por estudiante (cuenta, acceso, matrícula, cursos)
-- 3) Reparación: vincular, dar acceso e inscribir en las asignaturas de su nivel
-- =====================================================================

-- 1) La persona que entra con un correo confirmado toma su ficha de estudiante sin cuenta
create or replace function public.claim_my_student_records()
returns int language plpgsql security definer set search_path = '' as $$
declare v_email text; v_role uuid; v_n int := 0; r record;
begin
  if auth.uid() is null then return 0; end if;
  select lower(trim(u.email)) into v_email from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null or v_email = '' or not private.current_user_active() then return 0; end if;
  select id into v_role from public.roles where organization_id is null and code = 'estudiante';
  for r in select s.id, s.organization_id from public.students s
            where s.user_id is null and s.status = 'active' and lower(trim(coalesce(s.email, ''))) = v_email
            order by s.created_at loop
    update public.students set user_id = auth.uid()
     where id = r.id and user_id is null
       and not exists (select 1 from public.students o where o.organization_id = r.organization_id and o.user_id = auth.uid());
    if found then
      insert into public.memberships (user_id, organization_id, role_id) values (auth.uid(), r.organization_id, v_role)
      on conflict (user_id, organization_id, role_id, campus_id) do nothing;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.claim_my_student_records() from public, anon;
grant execute on function public.claim_my_student_records() to authenticated;

-- 2) Informe de acceso al Aula
create or replace function public.aula_access_report(p_org uuid)
returns table (student_id uuid, full_name text, email text, student_code text, account_email text,
               issue text, matriculas int, secciones int, programa text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission(p_org, 'students.view') then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
  with b as (
    select s.id, trim(coalesce(s.first_names, '') || ' ' || coalesce(s.last_names, '')) nm, s.email em, s.student_code sc, s.user_id uid,
           p.email pem, p.status::text pst,
           exists (select 1 from public.memberships m where m.user_id = s.user_id and m.organization_id = p_org and m.status = 'active'
                     and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())) mem,
           exists (select 1 from public.profiles pr where s.user_id is null and coalesce(trim(s.email), '') <> ''
                     and lower(pr.email) = lower(trim(s.email)) and pr.status = 'active'
                     and not exists (select 1 from public.students o where o.organization_id = p_org and o.user_id = pr.id)) cand,
           (select count(*) from public.enrollments e where e.student_id = s.id and e.status = 'active')::int nmat,
           (select count(*) from public.section_enrollments se join public.sections x on x.id = se.section_id
             where se.student_id = s.id and se.status <> 'dropped' and x.status = 'active')::int nsec,
           (select coalesce(pg.name, r.form_data ->> 'program') from public.registrations r
              left join public.programs pg on pg.id::text = r.form_data ->> 'program_id'
             where r.student_id = s.id order by r.created_at desc limit 1) prog
      from public.students s left join public.profiles p on p.id = s.user_id
     where s.organization_id = p_org and s.status = 'active')
  select b.id, b.nm, b.em, b.sc, b.pem,
         case when b.uid is null and b.cand then 'cuenta_sin_vincular'
              when b.uid is null then 'sin_cuenta'
              when b.pst <> 'active' then 'cuenta_suspendida'
              when not b.mem then 'sin_acceso'
              when b.nmat = 0 then 'sin_matricula'
              when b.nsec = 0 then 'sin_cursos'
              else 'ok' end,
         b.nmat, b.nsec, b.prog
    from b order by b.nm;
end $$;
revoke all on function public.aula_access_report(uuid) from public, anon;
grant execute on function public.aula_access_report(uuid) to authenticated;

-- 3) Reparación (todos o un estudiante). Con un estudiante elegido también reactiva su acceso revocado.
create or replace function public.aula_fix_access(p_org uuid, p_student uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record; e record; c record; x record; v_role uuid; v_uid uuid; v_term int; v_ok boolean;
  v_linked int := 0; v_access int := 0; v_sections int := 0; v_full int := 0; v_nomat int := 0; v_nooffer int := 0;
begin
  if not (private.has_permission(p_org, 'students.edit') and private.has_permission(p_org, 'enrollments.create')) then
    raise exception 'No autorizado: necesita editar estudiantes y matricular.' using errcode = '42501';
  end if;
  select id into v_role from public.roles where organization_id is null and code = 'estudiante';
  for r in select s.id, s.user_id, s.email from public.students s
            where s.organization_id = p_org and s.status = 'active' and (p_student is null or s.id = p_student) loop
    v_uid := r.user_id;
    -- a) ficha sin cuenta: se vincula con la cuenta activa del mismo correo
    if v_uid is null and coalesce(trim(r.email), '') <> '' then
      select pr.id into v_uid from public.profiles pr
       where lower(pr.email) = lower(trim(r.email)) and pr.status = 'active'
         and not exists (select 1 from public.students o where o.organization_id = p_org and o.user_id = pr.id)
       limit 1;
      if v_uid is not null then
        update public.students set user_id = v_uid where id = r.id and user_id is null;
        v_linked := v_linked + 1;
      end if;
    end if;
    -- b) acceso a la institución
    if v_uid is not null then
      if not exists (select 1 from public.memberships m where m.user_id = v_uid and m.organization_id = p_org) then
        insert into public.memberships (user_id, organization_id, role_id, granted_by) values (v_uid, p_org, v_role, auth.uid())
        on conflict (user_id, organization_id, role_id, campus_id) do nothing;
        v_access := v_access + 1;
      elsif p_student is not null and not exists (select 1 from public.memberships m where m.user_id = v_uid and m.organization_id = p_org and m.status = 'active') then
        update public.memberships set status = 'active', revoked_at = null, revoked_by = null
         where user_id = v_uid and organization_id = p_org and role_id = v_role;
        if not found then
          insert into public.memberships (user_id, organization_id, role_id, granted_by) values (v_uid, p_org, v_role, auth.uid());
        end if;
        v_access := v_access + 1;
      end if;
    end if;
    -- c) asignaturas: por cada matrícula activa sin cursos en su periodo, las de su nivel (menor semestre pendiente con sección abierta)
    if not exists (select 1 from public.enrollments en where en.student_id = r.id and en.status = 'active') then
      v_nomat := v_nomat + 1;
    end if;
    for e in select en.* from public.enrollments en where en.student_id = r.id and en.status = 'active' loop
      if exists (select 1 from public.section_enrollments se join public.sections s2 on s2.id = se.section_id
                  where se.student_id = r.id and se.status <> 'dropped' and s2.period_id = e.period_id) then continue; end if;
      select min(cc.term_number) into v_term from public.curriculum_courses cc
       where cc.curriculum_id = e.curriculum_id
         and exists (select 1 from public.sections s3 where s3.organization_id = p_org and s3.course_id = cc.course_id and s3.period_id = e.period_id
                       and s3.status = 'active' and s3.grades_closed_at is null)
         and not exists (select 1 from public.section_enrollments se join public.sections s4 on s4.id = se.section_id
                          where se.student_id = r.id and se.status <> 'dropped' and s4.course_id = cc.course_id);
      if v_term is null then v_nooffer := v_nooffer + 1; continue; end if;
      for c in select cc.course_id from public.curriculum_courses cc
                where cc.curriculum_id = e.curriculum_id and cc.term_number = v_term
                  and exists (select 1 from public.sections s5 where s5.organization_id = p_org and s5.course_id = cc.course_id and s5.period_id = e.period_id
                                and s5.status = 'active' and s5.grades_closed_at is null)
                  and not exists (select 1 from public.section_enrollments se join public.sections s6 on s6.id = se.section_id
                                   where se.student_id = r.id and se.status <> 'dropped' and s6.course_id = cc.course_id) loop
        v_ok := false;
        for x in select s7.id from public.sections s7
                  where s7.organization_id = p_org and s7.course_id = c.course_id and s7.period_id = e.period_id
                    and s7.status = 'active' and s7.grades_closed_at is null
                  order by (s7.campus_id = e.campus_id) desc,
                           (select count(*) from public.section_enrollments z where z.section_id = s7.id and z.status = 'enrolled'), s7.code loop
          begin
            perform public.register_section(r.id, x.id, false);
            v_ok := true; v_sections := v_sections + 1; exit;
          exception when others then null;  -- sin cupo, prerrequisito o choque: se prueba la siguiente sección
          end;
        end loop;
        if not v_ok then v_full := v_full + 1; end if;
      end loop;
    end loop;
  end loop;
  return jsonb_build_object('linked', v_linked, 'access', v_access, 'sections', v_sections, 'not_placed', v_full,
                            'no_matricula', v_nomat, 'no_offer', v_nooffer);
end $$;
revoke all on function public.aula_fix_access(uuid, uuid) from public, anon;
grant execute on function public.aula_fix_access(uuid, uuid) to authenticated;
