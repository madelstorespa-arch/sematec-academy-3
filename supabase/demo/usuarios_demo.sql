-- =====================================================================
-- Usuarios de DEMOSTRACIÓN con contraseña (Sematec-Demo-2026).
-- Solo para proyectos de prueba. Se crean directamente en Supabase Auth.
-- =====================================================================
do $$
declare
  u record;
begin
  for u in select * from (values
    ('00000000-0000-4000-8000-000000000001', 'superadmin@demo.sematec.test',      'Superadministrador Demo'),
    ('00000000-0000-4000-8000-000000000010', 'propietario.a@demo.sematec.test',   'Propietaria Institución A'),
    ('00000000-0000-4000-8000-000000000011', 'secretaria.a@demo.sematec.test',    'Secretaria Académica A'),
    ('00000000-0000-4000-8000-000000000012', 'tesoreria.a@demo.sematec.test',     'Tesorero A'),
    ('00000000-0000-4000-8000-000000000013', 'director.a@demo.sematec.test',      'Director Académico A'),
    ('00000000-0000-4000-8000-000000000014', 'auditor.a@demo.sematec.test',       'Auditora A'),
    ('00000000-0000-4000-8000-000000000015', 'soporte.a@demo.sematec.test',       'Soporte Técnico A'),
    ('00000000-0000-4000-8000-000000000016', 'matriculas.a@demo.sematec.test',    'Matrículas A'),
    ('00000000-0000-4000-8000-000000000020', 'profesor1.a@demo.sematec.test',     'Profesor Uno'),
    ('00000000-0000-4000-8000-000000000021', 'profesor2.a@demo.sematec.test',     'Profesora Dos'),
    ('00000000-0000-4000-8000-000000000030', 'estudiante1.a@demo.sematec.test',   'Estudiante Uno'),
    ('00000000-0000-4000-8000-000000000031', 'estudiante2.a@demo.sematec.test',   'Estudiante Dos'),
    ('00000000-0000-4000-8000-000000000032', 'estudiante3.a@demo.sematec.test',   'Estudiante Tres'),
    ('00000000-0000-4000-8000-000000000040', 'postulante@demo.sematec.test',      'Postulante Externo'),
    ('00000000-0000-4000-8000-000000000050', 'propietario.b@demo.sematec.test',   'Propietario Institución B'),
    ('00000000-0000-4000-8000-000000000051', 'estudiante1.b@demo.sematec.test',   'Estudiante B Uno')
  ) as t(id, email, name)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email,
            extensions.crypt('Sematec-Demo-2026', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name), now(), now(), '', '', '', '')
    on conflict (id) do nothing;
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id::uuid, u.id, jsonb_build_object('sub', u.id, 'email', u.email, 'email_verified', true), 'email', now(), now(), now())
    on conflict do nothing;
  end loop;
end $$;
